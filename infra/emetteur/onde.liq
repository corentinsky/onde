# Émetteur Onde : un flux par enseigne.
# Onde (la régie) choisit chaque titre et ses réglages ; Liquidsoap enchaîne et diffuse.
#
# Réglages lus dans l’environnement :
#   ONDE_URL     adresse de la régie, ex. https://onde-rust.vercel.app
#   ONDE_CLE     clé de l’émetteur, créée dans Régie → Émetteur
#   PUBLIC_URL   adresse publique des flux, ex. http://localhost:8000
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

# Téléchargement d’un titre : « onde:<extension>|<lien signé> ». L’extension est donnée par Onde,
# car le lien signé (jeton dans l’adresse) ne permet pas de la deviner.
def onde_protocol(~rlog, ~maxtime, arg) =
  parts = string.split(separator="\\|", arg)
  ext = list.hd(default="mp3", parts)
  uri = string.concat(separator="|", list.tl(parts))
  output = file.temp("onde-titre", ".#{ext}")
  writer = file.write.stream(output)
  try
    r = http.get.stream(on_body_data=writer, timeout=maxtime - time(), uri)
    if r.status_code < 400 then
      [output]
    else
      rlog("Téléchargement refusé : #{r.status_code}")
      []
    end
  catch err do
    rlog("Téléchargement impossible : #{err}")
    []
  end
end
protocol.add(temporary=true, syntax="onde:<ext>|<url>", doc="Titre de la bibliothèque Onde", "onde", onde_protocol)

if onde == "" or cle == "" then
  log.critical("ONDE_URL et ONDE_CLE sont obligatoires.")
  shutdown(code=1)
end

# Liste des flux à diffuser : « version <empreinte> » puis « <enseigne> <point de montage> <nom> ».
def read_config() =
  r = http.get(headers=auth, timeout=20., "#{onde}/api/emitter/config?public_url=#{url.encode(public_url)}")
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
      end
    end
  )

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
