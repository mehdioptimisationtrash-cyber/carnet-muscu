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

## 6. Pas quotidiens automatiques (Santé → Raccourcis → feuille)

Une app web n'a pas accès à Santé ni à Pedometer++. Le contournement : un **raccourci iOS** lit tes pas dans Santé (où Pedometer++ et l'Apple Watch les déposent) et les envoie directement dans l'onglet `pas` de la feuille. Le carnet les relit à chaque retour au premier plan (ou via « ↻ Relire la feuille » dans la jauge 🚶 du Journal). La saisie manuelle reste possible (touche la jauge).

Prérequis : `Code.gs` **v5** collé et redéployé (voir « Si tu modifies Code.gs »).

Pourquoi deux sources : sans filtre, Raccourcis additionne les échantillons de l'iPhone et de la montre (2 383 au lieu de 1 590 dans Santé) et ne sait pas refaire la fusion de Santé. Une source seule ne suffit pas non plus : la montre n'est pas portée tous les jours. Le raccourci envoie donc **les deux totaux** et le script garde **le plus grand** : montre portée → montre (1 520, ≈ Santé), sinon → iPhone.

Le raccourci « Muscu Pas », 5 actions :
1. **Rechercher des échantillons de santé** — Type : *Pas* · Date de début : *est aujourd'hui* · Source : *est* « iPhone de Mehdi » · *Grouper par : Jour*.
2. **Calculer des statistiques** — *Somme* des échantillons de l'action 1 → total iPhone.
3. **Rechercher des échantillons de santé** — idem, Source : *est* « Apple Watch de Mehdi ».
4. **Calculer des statistiques** — *Somme* des échantillons de l'action 3 → total montre.
5. **Obtenir le contenu de l'URL** — URL = `SHEETS_URL` de `config.js` · Méthode *POST* · Corps *JSON* avec trois champs : `token` (texte, le `TOKEN` de `config.js`), `iphone` (nombre = Statistiques de l'action 2), `montre` (nombre = Statistiques de l'action 4). Champ facultatif `date` (texte `AAAA-MM-JJ`), sinon date du jour (fuseau de la feuille). La forme à un seul champ `steps` reste acceptée.

L'app copie l'URL et le jeton pour toi : Journal → jauge 🚶 → « Remplissage automatique : comment ça marche ? ».

**À la demande** : dans la jauge 🚶, « 📲 Actualiser depuis Santé » lance le raccourci (`shortcuts://run-shortcut?name=Muscu%20Pas`, le nom doit être exact). Raccourcis s'ouvre, exécute, et tu reviens dans le carnet via « ◀ Muscu » en haut à gauche : l'app relit alors la feuille (3 essais sur 10 s, le temps que l'envoi arrive) et affiche le total.

**Automatique toutes les 3 h** : iOS ne sait pas répéter une automatisation toutes les X heures, il faut **une automatisation par horaire** (8 au total, ~1 min chacune) :
Raccourcis → onglet *Automatisation* → **+** → *Heure de la journée* → heure (ex. **06:00**) → *Tous les jours* → **Exécuter immédiatement** (et décocher « Me notifier lors de l'exécution ») → Suivant → choisir « Muscu Pas » → OK.
Horaires : **06:00, 09:00, 12:00, 15:00, 18:00, 21:00, 23:55** (+ 03:00 si tu veux, inutile la nuit). Le 23:55 fige le total de la journée. À la première exécution, iOS demande d'autoriser l'envoi vers script.google.com et l'accès à Santé : **Toujours autoriser**. Santé n'est lisible que téléphone **déverrouillé une fois depuis le démarrage** ; si l'iPhone est éteint à l'heure dite, l'envoi suivant rattrape (il remplace le total du jour).

Chaque envoi du raccourci **remplace** le total du jour **s'il est plus grand** (Code.gs v6) : un envoi à 0 ou en baisse, typique d'une automatisation qui tourne iPhone verrouillé (Santé illisible), est ignoré. Une saisie manuelle dans l'app peut, elle, corriger à la baisse.

Contrat du script (`doPost`) : `{ token, iphone: 961, montre: 1520 }` (ou `{ token, steps: 8432 }`), `date` facultative → réponse `{ ok: true, v: 5, steps: { '2026-09-22': { n: 1520, src: 'sante', detail: 'montre (montre 1520 · iphone 961)' } } }`. Un appel sans `state` est accepté (il n'écrit que les pas). Test unitaire : `node tools/test_codegs.js apps-script/Code.gs`.

## 7. Macros depuis l'app Assiette (automatique, toutes les 3 h)

Assiette (autre PWA, suivi alimentaire) sauvegarde déjà chaque jour dans **sa** feuille Google, onglet `jours` (kcal, protéines, glucides, lipides, fibres). `Code.gs` **v6** du carnet recopie ces colonnes dans l'onglet `macros` de la feuille du carnet **toutes les 3 h via un déclencheur Google** : aucun téléphone ni raccourci nécessaire. Le carnet relit la feuille au retour au premier plan.

Mise en place (une fois) :
1. Ouvre la feuille Google d'**Assiette** et copie son adresse (`https://docs.google.com/spreadsheets/d/…/edit`).
2. Dans la feuille du **carnet** : Extensions → Apps Script → colle `apps-script/Code.gs` (v6), puis remplace `const ASSIETTE_SHEET_URL = '';` par l'adresse copiée (garder les apostrophes) → 💾.
3. En haut de l'éditeur, choisis la fonction **`installerAssiette`** → **Exécuter** → autorise l'accès (Google demande de voir tes feuilles et d'exécuter des déclencheurs : « Paramètres avancés → Accéder à … (non sécurisé) » est normal pour ton propre script). Le journal d'exécution affiche « Déclencheur installé … N jours recopiés ».
4. Déployer → Gérer les déploiements → ✏️ → Version : **Nouvelle version** → Déployer (même URL).

Dans le carnet : quand Assiette a des données pour un jour, **les jauges Calories / Protéines du Journal, le calendrier et les stats nutrition utilisent les chiffres d'Assiette** (ligne « 🍽️ Depuis Assiette · glucides … · lipides … · relevé à hh:mm ») ; l'alcool reste celui saisi dans le carnet. Les macros ne sont jamais renvoyées par l'app (le script seul les écrit). Pour changer la fréquence : `ASSIETTE_EVERY_HOURS`, puis relancer `installerAssiette` (il remplace l'ancien déclencheur).

## Données

- Source de vérité : la feuille Google (`state` = cibles/XP/réglages, `historique` = une ligne par séance, `nutrition` = une ligne par jour, `pas` = une ligne par jour, `macros` = copie d'Assiette).
- `localStorage` = cache d'affichage et tampon hors-ligne ; s'il est vidé, tout revient depuis la feuille au prochain lancement.
- Boutons **Exporter / Importer** : sauvegarde JSON manuelle (filet de sécurité).
