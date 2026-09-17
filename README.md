# Carnet Muscu

Carnet de musculation installable sur iPhone (PWA), sauvegardé dans une feuille Google Sheets personnelle.
HTML / CSS / JS vanilla, hébergé sur GitHub Pages, entièrement gratuit.

- Site : `https://mehdioptimisationtrash-cyber.github.io/carnet-muscu/`
- Une seule séance type ; chaque série a sa cible (charge × reps) et progresse toute seule (double progression : +1 rep, puis +1 cran de charge à 15 reps).
- XP, niveaux, records, paliers, minuteur de repos, stats et axes d'amélioration.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | l'application |
| `sync.js` | lecture/écriture Google Sheets, file d'attente hors-ligne |
| `config.js` | URL du script Google + jeton (**visibles publiquement**, voir Sécurité) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (hors-ligne, écran d'accueil) |
| `apps-script/Code.gs` | le script à coller dans Google Sheets |
| `tools/make-icons.py` | régénère les icônes |

## 1. Brancher Google Sheets (à faire une fois, ~5 min)

1. Crée une feuille Google vide : <https://sheets.new> — nomme-la « Carnet Muscu ».
2. Menu **Extensions → Apps Script**. Un éditeur s'ouvre avec un fichier `Code.gs`.
3. Efface son contenu, colle **tout** le contenu de `apps-script/Code.gs` de ce dépôt, puis 💾 (Ctrl/Cmd+S).
4. En haut à droite : **Déployer → Nouveau déploiement**.
   - Clique la roue dentée ⚙️ à côté de « Sélectionner le type » → **Application web**.
   - Description : `carnet muscu`
   - **Exécuter en tant que** : `Moi`
   - **Qui a accès** : `Tout le monde` (obligatoire : l'app n'a pas de compte Google, elle est identifiée par le jeton)
   - **Déployer**.
5. Google demande une autorisation : **Autoriser l'accès** → choisis ton compte → « Google n'a pas validé cette application » → *Paramètres avancés* → *Accéder à carnet muscu (non sécurisé)* → *Autoriser*. (C'est ton propre script ; ce message apparaît pour tout script personnel.)
6. Copie l'**URL de l'application web** (`https://script.google.com/macros/s/…/exec`).
7. Colle-la dans `config.js` → `SHEETS_URL: '…'`. Le jeton `TOKEN` doit être le même dans `config.js` et `Code.gs` (c'est déjà le cas).

Test rapide depuis le Mac (remplace l'URL et le jeton) :

```bash
curl -L "https://script.google.com/macros/s/XXX/exec?token=LE_JETON"
# → {"ok":true,"state":null}   (feuille encore vide)
```

Les onglets `state`, `historique` et `exercices` sont créés à la première sauvegarde.
Sauvegarde dans le temps : **Fichier → Historique des versions** dans Google Sheets.

### Si tu modifies `Code.gs` plus tard

**Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer.** L'URL reste la même.

## 2. Sécurité — à lire

Le site est statique : `config.js` (URL du script + jeton) est **lisible par n'importe qui** qui ouvre le code source. Aucune variable d'environnement ni « secret » ne peut cacher ça côté client.

Ce qui protège réellement :
- le script ne sait faire qu'une chose : lire/écrire **cette** feuille (il tourne avec ton compte, mais son code ne touche à rien d'autre) ;
- le jeton bloque les appels au hasard ;
- tu peux **révoquer** à tout moment : Apps Script → Déployer → Gérer les déploiements → Archiver, puis nouveau déploiement (nouvelle URL) + nouveau jeton dans `config.js` et `Code.gs`.

Pourquoi pas une clé d'API Google Sheets ? Une clé d'API ne permet **que la lecture** sur une feuille publique ; toute écriture exige OAuth. Et une clé ne peut pas être restreinte à une seule feuille (seulement par API et par site référent).

## 3. Développer et tester sur le Mac

```bash
cd carnet-muscu
python3 -m http.server 8000
# → http://localhost:8000  (Safari : Développement → Passer en User-Agent / mode responsive iPhone)
```

Le service worker fonctionne sur `localhost`. Sur l'iPhone, il exige HTTPS : teste via GitHub Pages (déploiement ≈ 1 min).

## 4. Déployer sur GitHub Pages

- Repo public `carnet-muscu`, branche `main`, Pages activé sur `/ (root)`.
- Tous les chemins sont relatifs (`./…`) : le site fonctionne sous `/carnet-muscu/`.
- `.nojekyll` évite tout traitement Jekyll.
- **À chaque modification** de `app.js`/`styles.css`/`index.html` : incrémente `CACHE_VERSION` dans `sw.js`, sinon les iPhones gardent l'ancienne version en cache.

```bash
git add -A && git commit -m "feat: …" && git push
```

## 5. Installer sur l'iPhone

Safari → ouvre l'URL du site → bouton **Partager** → **Sur l'écran d'accueil** → Ajouter.
L'app s'ouvre en plein écran, fonctionne hors-ligne, et envoie les séances à Google Sheets dès que le réseau revient.

## Données

- Source de vérité : la feuille Google (`state` = cibles/XP/réglages, `historique` = une ligne par séance).
- `localStorage` = cache d'affichage et tampon hors-ligne ; s'il est vidé, tout revient depuis la feuille au prochain lancement.
- Boutons **Exporter / Importer** : sauvegarde JSON manuelle (filet de sécurité).
