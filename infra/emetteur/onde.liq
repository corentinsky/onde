# Émetteur Onde : un flux par enseigne.
# Onde (la régie) choisit chaque titre et ses réglages ; Liquidsoap enchaîne et diffuse.
#
# Réglages lus dans l’environnement :
#   ONDE_URL     adresse de la régie, ex. https://onde-rust.vercel.app
#   ONDE_CLE     clé de l’émetteur, créée dans Régie → Émetteur
#   PUBLIC_URL   adresse publique des flux, ex. http://localhost:8000
#   ONDE_CACHE   dossier des titres gardés sur le disque (défaut /var/cache/onde)
#   ONDE_BIBLIOTHEQUE  dossier de la bibliothèque déposée par la régie (défaut /var/lib/onde/bibliotheque)
#   ICECAST_PASSWORD  mot de passe interne Icecast (généré au démarrage)

settings.init.allow_root.set(true)
settings.log.stdout.set(true)
settings.log.file.set(false)
settings.log.level.set(3)

onde = environment.get("ONDE_URL")
cle = environment.get("ONDE_CLE")
public_url = environment.get(default="http://localhost:8000", "PUBLIC_URL")
icecast_password = environment.get("ICECAST_PASSWORD")
auth = [("Authorization", "Bearer #{cle}"), ("User-Agent", "Onde-Emetteur/1.0")]

# Titres gardés sur le disque de l’émetteur : chaque fichier n’est téléchargé qu’une fois
# (au lieu d’une fois par passage), ce qui garde la bande passante du stockage au minimum.
# « onde:<fichier>|<lien signé> » : <fichier> est le nom du titre dans la bibliothèque (identifiant + extension).
# Les titres qui ne passent plus depuis 30 jours sont effacés par le démarrage (entrypoint.sh).
cache_dir = environment.get(default="/var/cache/onde", "ONDE_CACHE")
# Bibliothèque déposée sur ce serveur par la régie : lue directement sur le disque.
library_dir = environment.get(default="/var/lib/onde/bibliotheque", "ONDE_BIBLIOTHEQUE")

def onde_protocol(~rlog, ~maxtime, arg) =
  parts = string.split(separator="\\|", arg)
  key = list.hd(default="", parts)
  uri = string.concat(separator="|", list.tl(parts))
  if not r/^[A-Za-z0-9][A-Za-z0-9_-]{7,100}\.[a-z0-9]{2,5}$/.test(key) or uri == "" then
    rlog("Adresse de titre invalide.")
    []
  else
    here = "#{library_dir}/#{key}"
    path = "#{cache_dir}/#{key}"
    if file.exists(here) and file.size(here) > 0 then
      [here]
    elsif not string.contains(prefix="http", uri) then
      rlog("Titre absent de ce serveur : #{key}")
      []
    elsif file.exists(path) and file.size(path) > 0 then
      # Date d’utilisation : le ménage ne retire que les titres qui ne passent plus.
      ignore(process.run("touch -c #{process.quote(path)}"))
      [path]
    else
      part = "#{path}.#{random.int(min=0, max=999999999)}.part"
      writer = file.write.stream(part)
      try
        r = http.get.stream(on_body_data=writer, timeout=maxtime - time(), uri)
        if r.status_code < 400 and file.exists(part) and file.size(part) > 0 then
          file.move(part, path)
          [path]
        else
          rlog("Téléchargement refusé : #{r.status_code}")
          if file.exists(part) then file.remove(part) end
          []
        end
      catch err do
        rlog("Téléchargement impossible : #{err}")
        if file.exists(part) then file.remove(part) end
        []
      end
    end
  end
end
protocol.add(temporary=false, syntax="onde:<fichier>|<url>", doc="Titre de la bibliothèque Onde (gardé en cache)", "onde", onde_protocol)

if onde == "" or cle == "" then
  log.critical("ONDE_URL et ONDE_CLE sont obligatoires.")
  shutdown(code=1)
end

# Adresse publique des flux : sur un serveur, entrypoint.sh écrit la première adresse HTTPS
# qui répond avec un certificat valide ; sinon PUBLIC_URL.
def public_address() =
  f = "/tmp/onde-public-url"
  u = if file.exists(f) then string.trim(file.contents(f)) else "" end
  if u != "" then u else public_url end
end

# Liste des flux à diffuser : « version <empreinte> » puis « <enseigne> <point de montage> <nom> ».
def read_config() =
  r = http.get(headers=auth, timeout=20., "#{onde}/api/emitter/config?bibliotheque=1&public_url=#{url.encode(public_address())}")
  if r.status_code == 200 then
    r
  else
    log.important("Configuration indisponible (#{r.status_code}), nouvel essai dans 10 s.")
    ""
  end
end

config = ref(read_config())
while config() == "" do
  log.important("En attente de la régie…")
  sleep(10.)
  config := read_config()
end

lines = list.filter(fun (l) -> l != "", string.split(separator="\n", config()))
version = list.hd(default="", lines)

def stream(line) =
  parts = string.split(separator=" ", line)
  org = list.nth(default="", parts, 0)
  mount = list.nth(default="", parts, 1)
  name = string.concat(separator=" ", list.tl(list.tl(parts)))

  # Titre suivant, choisi par Onde : liste, poids, espacements, journée type, points de mix, volume.
  def next() =
    r = http.get(headers=auth, timeout=20., "#{onde}/api/emitter/next?org=#{org}")
    if r.status_code == 200 and string.trim(r) != "" then
      request.create(string.trim(r))
    else
      log.important("#{mount} : pas de titre (#{r.status_code}).")
      null()
    end
  end

  # Rien à jouer (liste vide, régie injoignable) : nouvel essai toutes les 20 s, sans surcharger la régie.
  s = request.dynamic(id="titres_#{mount}", retry_delay=20., prefetch=1, next)
  # Volume de chaque titre (EBU R128, calculé à l’analyse) : métadonnée liq_amplify.
  s = amplify(override="liq_amplify", 1., s)
  # Enchaînement au point de chevauchement : liq_cross_duration, liq_fade_in, liq_fade_out.
  s = crossfade(id="enchainement_#{mount}", duration=8., fade_in=0.1, fade_out=2., minimum=0., s)

  # Voix posées sur l’intro (a cappella) : jouées par-dessus le début du titre, la musique baisse
  # de 10 dB dessous puis remonte en douceur. Onde choisit la voix et le moment (métadonnées onde_overlay).
  voices = request.queue(id="voix_#{mount}", interactive=false)
  voice = amplify(override="liq_amplify", 1., voices)
  duck = ref(1.)
  thread.run.recurrent(fun () ->
    begin
      target = if voices.is_ready() then 0.32 else 1. end
      duck := duck() + (target - duck()) * 0.25
      0.04
    end
  )

  # Titre réellement lancé : Onde met à jour « en cours » et l’historique.
  # (Les enchaînements ne marquent pas de fin de piste : on suit les métadonnées.)
  last_play = ref("")
  s.on_metadata(fun (m) ->
    begin
      play = m["onde_play"]
      if play != "" and play != last_play() then
        last_play := play
        thread.run(fun () ->
          ignore(http.post(headers=auth, timeout=10., "#{onde}/api/emitter/started?play=#{play}"))
        )
        overlay = m["onde_overlay"]
        if overlay != "" then
          gain = m["onde_overlay_gain"]
          delay = float_of_string(default=0.3, m["onde_overlay_delay"])
          thread.run(delay=delay, fun () ->
            voices.push.uri("annotate:liq_amplify=\"#{gain} dB\":onde:#{overlay}")
          )
        end
      end
    end
  )
  # (override=null : sinon le volume liq_amplify du titre remplacerait la baisse.)
  s = amplify(override=null(), {duck()}, s)
  s = add(normalize=false, [s, source.drop.metadata(voice)])

  # Silence plutôt qu’une coupure si la régie ne répond pas : le lecteur prend alors le relais.
  s = mksafe(s)
  output.icecast(
    %mp3(bitrate=128, samplerate=44100, stereo=true),
    host="127.0.0.1",
    port=8001,
    password=icecast_password,
    mount=mount,
    name=name,
    description="Onde",
    encoding="UTF-8",
    s
  )
end

list.iter(stream, list.tl(lines))
log.important("Flux en service : #{list.length(list.tl(lines))} (#{version}).")

# Nouvelle enseigne ou nouveau réglage : on redémarre pour reprendre la configuration.
thread.run(every=60., fun () ->
  begin
    c = read_config()
    if c != "" and list.hd(default="", string.split(separator="\n", c)) != version then
      log.important("Configuration modifiée : redémarrage.")
      shutdown()
    end
  end
)
