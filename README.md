# MA3 Fixture Builder

Petite application web (PWA) pour créer la fiche d'un projecteur absent de la bibliothèque grandMA3, et l'exporter en fichier **.gdtf**, importable dans la console.

Elle n'a besoin d'aucune installation : c'est du HTML/JavaScript pur, sans dépendance. Une fois ouverte, elle fonctionne aussi hors ligne.

## En ligne

L'appli est publiée sur **https://yannhureau-netizen.github.io/ma3-fixture-builder/** (GitHub Pages). Elle s'ouvre sur PC, tablette ou téléphone et s'installe comme une appli (icône « Installer » du navigateur). Les fiches restent enregistrées sur chaque appareil : pour passer de l'un à l'autre, utilise « Tout sauvegarder » puis « Importer une sauvegarde ».

### Publier une mise à jour

1. Change `VERSION` dans `sw.js` (ex. `fb-v4` → `fb-v5`), pour que les appareils récupèrent la nouvelle version.
2. Dans PowerShell, dans ce dossier :
   ```
   git add -A
   git commit -m "Description du changement"
   git push
   ```
3. Le site est à jour au bout d'une minute environ.

## Lancer l'appli sur ce PC

Le plus simple : **double-clique sur `Lancer l'appli.bat`**. Le serveur démarre et l'appli s'ouvre dans le navigateur. Laisse la fenêtre noire ouverte pendant que tu travailles, et ferme-la pour arrêter. Si le serveur tourne déjà, le fichier ouvre juste le navigateur.

Sinon, à la main :

1. Ouvre une fenêtre PowerShell dans ce dossier.
2. Tape :
   ```
   powershell -ExecutionPolicy Bypass -File serveur.ps1
   ```
3. Ouvre **http://localhost:8090** dans Chrome ou Edge. (Pas 8080 : ce port est utilisé par grandMA3 onPC.)
4. Pour l'installer comme une appli : icône « Installer » dans la barre d'adresse.

Pour arrêter le serveur : `Ctrl+C` dans la fenêtre PowerShell.

> Ouvrir directement `index.html` en double-cliquant ne marche pas : les navigateurs bloquent les modules JavaScript en `file://`. Il faut passer par le serveur.

## Utilisation en 5 étapes

Sur l'accueil, la recherche (fabricant, nom… sans tenir compte des accents) et le tri (récents, fabricant, nom) aident à retrouver une fiche.

En cliquant sur **« + Nouveau projecteur »**, choisis un point de départ : fiche vide, ou modèle tout prêt (PAR LED RGB / RGBW / RGBWA+UV, lyre spot / wash / beam, barre LED 8 pixels, découpe LED, stroboscope). Le modèle donne des modes et des canaux courants, que tu ajustes ensuite d'après la doc.

1. **Projecteur** : fabricant, nom, lyre ou fixe, type de source. Facultatif : une **photo** (affichée dans le Patch de grandMA3), les **dimensions** (taille dans la vue 3D) et le **poids**.
2. **Roues** (facultatif) : roues de couleurs, de gobos, prismes… avec la couleur ou l'image de chaque fente.
3. **Canaux DMX** : ajoute les canaux dans l'ordre de la doc du fabricant avec les boutons « + Intensité », « + Pan / Tilt 16 bits », « + RGB »… Le bouton **Plages** permet de découper un canal (ex. 0–7 fermé, 8–15 ouvert, 16–249 strobe), et d'ajouter des **réglages nommés** (un gobo, une couleur). La case « Réglages avancés » affiche les valeurs physiques (degrés, Hz…). « + Canal inutilisé » réserve une adresse sans fonction.
4. **Tester** : un fader par canal, comme sur la console. L'appli affiche la plage et le réglage actifs, la valeur physique (degrés, Hz, %…) et un aperçu du résultat : couleur, intensité, shutter ou strobe, gobo, Pan/Tilt, sous-éléments. Les boutons « Valeurs par défaut », « Plein feu » et « Tout à 0 » donnent un point de départ.
5. **Exporter** : l'appli vérifie la fiche (erreurs bloquantes et **conseils**, par exemple « Pan en 8 bits », « Intensité par défaut à 255 », « roue reliée à aucun canal »), puis télécharge le fichier `.gdtf`. Le bouton **« Fiche DMX imprimable »** donne un document propre (photo, caractéristiques, roues, tableau de chaque mode) à imprimer ou à enregistrer en PDF.

### Plages conditionnelles (variantes)

Sur certains projecteurs, un canal change de comportement selon un autre canal. Par exemple, le canal « position du gobo » fait un index quand la roue est sur un gobo fixe, et une rotation quand elle est sur un gobo tournant. Dans les **Plages** d'un canal, **« + Variante conditionnelle »** (visible avec « Réglages avancés ») ajoute un jeu de plages actif seulement quand un autre canal est entre deux valeurs. Chaque variante se découpe de 0 à 255 indépendamment. Le testeur en tient compte, et l'export écrit les attributs GDTF `ModeMaster`, `ModeFrom` et `ModeTo`.

### Mode dérivé

Beaucoup de docs proposent plusieurs modes presque identiques. À l'étape **Canaux DMX**, le bouton **« Créer un mode dérivé… »** crée un nouveau mode à partir du mode affiché : tu choisis son nom, tu peux passer tous les canaux 16 bits en 8 bits, et tu coches les canaux à garder. Le nombre d'adresses s'affiche en direct, et le mode d'origine n'est pas modifié.

### Roues de couleurs et de gobos

Pour que grandMA3 affiche les vraies couleurs et les images des gobos :

1. À l'étape **Roues**, crée la roue (« + Roue de couleurs », « + Roue de gobos »…). Pour chaque fente : une couleur (pastille) ou une image (bouton « Image… », n'importe quel format, convertie en PNG).
2. À l'étape **Canaux DMX**, ajoute le canal (« + Roue de couleurs » / « + Roue de gobos ») : il est relié tout seul à la roue. Sinon, ouvre ses **Plages** et choisis la roue dans le menu « Roue ».
3. Clique sur **« Créer un réglage par fente »** : un réglage par fente est créé, avec des valeurs DMX réparties régulièrement. Corrige ensuite les valeurs DMX d'après la doc.

### Ouvrir un fichier .gdtf existant

Sur l'accueil, **« Ouvrir un fichier .gdtf »** transforme un fichier GDTF (par exemple de GDTF Share ou de la bibliothèque d'une console) en fiche modifiable : modes, canaux, plages, réglages, roues avec couleurs et images, sous-éléments. Une fois corrigée, exporte-la à nouveau. Elle garde son identifiant, et le numéro de révision augmente.

Ce qui n'est pas repris, et que l'appli signale à l'ouverture :
- la forme 3D d'origine (l'appli recrée une structure simple) ;
- les canaux virtuels (sans adresse DMX) ;
- les plages conditionnelles dont le canal maître est introuvable (les autres sont reprises) ;
- les canaux sur un 2e univers DMX.

Les valeurs 16 bits sont arrondies à l'échelle 0-255.

### Sous-éléments (pixels, calques d'effet…)

Certains projecteurs ont plusieurs zones pilotées séparément : les pixels d'une barre LED, un anneau d'effet, un calque de fond… À l'étape 1, la section **Sous-éléments** permet d'en créer. Chacun devient, dans grandMA3, une sous-partie du projecteur avec sa propre intensité et ses propres couleurs.

- **+ Ajouter un sous-élément** : crée un élément que tu nommes (ex. « Liquid », « Fond »).
- **Barre LED / projecteur à pixels** : crée d'un coup N cellules identiques (RGB, RGBW, Intensité + RGB…) avec leurs canaux.
- À l'étape « Canaux DMX », chaque canal a un menu pour choisir son élément, et « Ajouter sur » choisit où vont les canaux ajoutés par les boutons.

Pan et Tilt restent toujours sur le projecteur principal. Une même fonction (ex. Intensité) peut exister une fois par élément.

Tes projecteurs sont enregistrés automatiquement **dans le navigateur** de cet appareil. Pense à faire « Tout sauvegarder » (fichier .json) de temps en temps : si tu vides les données du navigateur, ils seront perdus.

## Importer dans grandMA3

1. Copie le `.gdtf` sur une clé USB dans `grandMA3/gma3_library/fixturetypes/`.
2. Sur la console : **Patch** → onglet **Fixture Types** → **Import** → clé USB → ton fichier.
3. Fais d'abord un essai sur **grandMA3 onPC** (gratuit).

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `css/style.css` | La page et son style |
| `js/app.js` | L'interface (écrans, boutons) |
| `js/attributes.js` | La liste des fonctions GDTF (Dimmer, Pan, ColorAdd_R…) avec leur libellé français |
| `js/model.js` | Les données, les modèles de canaux « + … », le mode dérivé et les vérifications |
| `js/starters.js` | Les modèles de départ (PAR, lyres, barre LED…) |
| `js/tester.js` | Le testeur DMX : plage active, valeur physique, aperçu |
| `js/print.js` | La fiche DMX imprimable |
| `js/gdtf.js` | La fabrication du `description.xml` au format GDTF 1.1 (avec roues et images) |
| `js/gdtf-import.js` | La lecture d'un `.gdtf` existant |
| `js/color.js` | Conversion des couleurs (format GDTF CIE xyY) et des images en PNG |
| `js/zip.js`, `js/unzip.js` | Écriture et lecture des zip (un .gdtf est un zip) |
| `js/storage.js` | La sauvegarde dans le navigateur |
| `sw.js`, `manifest.webmanifest` | Le mode hors ligne et l'installation en appli |
| `serveur.ps1` | Le petit serveur local pour tester |
| `Lancer l'appli.bat` | Double-clic : lance le serveur et ouvre l'appli |

Quand tu modifies des fichiers, change `VERSION` dans `sw.js` pour que l'appli installée se mette à jour.

## Pas encore géré (pistes pour la suite)

- Lecture directe d'une page PDF (tableau DMX) pour remplir la fiche
- Canaux virtuels (dimmer virtuel sur un projecteur RGB sans dimmer)
- Synchronisation des fiches entre appareils
- Facettes des prismes
