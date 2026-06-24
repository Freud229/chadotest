# Gestion Boutique

Application web de gestion boutique avec base de donnees fichier cote serveur.

## Ouvrir l'application

### Mode partage entre plusieurs appareils

Lancer le serveur depuis le dossier du projet :

```text
node server.js
```

Puis ouvrir l'application avec l'adresse affichee par le serveur, par exemple :

```text
http://adresse-du-serveur:3721/
```

Quand le site est heberge, tous les ordinateurs et telephones doivent ouvrir cette meme adresse. Les utilisateurs crees par l'administrateur sont alors enregistres dans la base commune et peuvent se connecter depuis un autre appareil.

La base est creee automatiquement dans :

```text
data/GestionBoutique_DB.json
data/GestionBoutique_DB.xlsx
```

Pour creer la base sans lancer l'application :

```text
node server.js --init-db
```

### Mode local simple

Il est encore possible de double-cliquer sur :

```text
index.html
```

Ou l'ouvrir avec Chrome / Edge.

## Connexion demo

```text
Utilisateur : admin
Mot de passe : 1234@dmin100%
```

## Fonctionnalites disponibles

- Produits
- Stock magasin
- Transfert magasin vers boutique
- Transfert de plusieurs produits en un seul envoi
- Reception du stock par la boutique avant ajout au stock disponible
- Notification de reception en attente cote stock boutique
- Stock boutique
- Caisse avec panier
- Fusion automatique des quantites si le produit existe deja dans le panier
- Validation paiement
- Historique ventes
- Facture imprimable / enregistrable en PDF
- Sauvegarde JSON
- Exports CSV ouvrables avec Excel

## Important

Pour le partage entre appareils, ne pas ouvrir directement `index.html` sur chaque machine. Il faut passer par l'adresse du serveur, sinon chaque navigateur travaille seul.

Garder une copie reguliere du dossier `data`, car il contient la base commune.
