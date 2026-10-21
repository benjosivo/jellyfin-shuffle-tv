# Ancien fonctionnement (référence)

- `auth.py` : générait `~/.config/jellyfin-office/token` et `user_id`. Remplacé par l'assistant de configuration de l'interface web ; un token déjà créé par ce script reste utilisé tel quel.
- `the-office-random.fish` : la boucle de lecture d'origine, remplacée par le service `jellyfin-office`. Le texte du script n'est pas reproduit ici ; son comportement est repris dans `src/player/loop.ts` (voir les commentaires en tête de fichier), avec les corrections décrites dans le README principal.

À ne plus lancer : les deux pilotent MPV Shim et se gêneraient.
