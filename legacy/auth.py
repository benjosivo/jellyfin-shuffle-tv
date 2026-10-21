# Ancien script de connexion (référence). Remplacé par l'assistant de configuration de
# l'application : il n'est plus nécessaire de le lancer.
import getpass
import json
import urllib.request
 
SERVER = "http://192.168.1.122:8096"
 
password = getpass.getpass("Mot de passe Jellyfin : ")
 
data = json.dumps({
    "Username": "En Boucle",
    "Pw": password
}).encode()
 
headers = {
    "Content-Type": "application/json",
    "Authorization": 'MediaBrowser Client="CachyOS Office Auto", Device="CachyOS", DeviceId="cachyos-office-auto", Version="1.0"'
}
 
request = urllib.request.Request(
    SERVER + "/Users/AuthenticateByName",
    data=data,
    headers=headers,
    method="POST"
)
 
try:
    with urllib.request.urlopen(request) as response:
        result = json.loads(response.read())
 
    if "AccessToken" not in result:
        print("Erreur : aucun token reçu.")
        print(result)
        raise SystemExit(1)
 
    config_dir = "/home/" + __import__("os").getlogin() + "/.config/jellyfin-office"
 
    with open(config_dir + "/token", "w") as f:
        f.write(result["AccessToken"])
 
    with open(config_dir + "/user_id", "w") as f:
        f.write(result["User"]["Id"])
 
    print("Connexion Jellyfin réussie.")
    print("Utilisateur :", result["User"]["Name"])
 
except Exception as e:
    print("Erreur :", e)
