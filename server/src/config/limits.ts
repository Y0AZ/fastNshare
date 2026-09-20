// Règles métier centralisées (section 5.4 du plan) : une seule source de vérité, appliquée côté serveur.
// Chaque tâche ajoute ici les limites qu'elle met en œuvre (tailles et nombre de fichiers en T2.2, durée de vie…).

// 8 caractères : assez court pour être dicté ou recopié, assez long pour rendre la devinette irréaliste
// (31^8 ≈ 852 milliards de combinaisons, à comparer aux 20 essais / 15 min autorisés par IP en T2.4).
export const CODE_LENGTH = 8;

// Sans 0/O, 1/I/L : les caractères qu'on confond à l'écrit ou à l'oral sont exclus. 8 chiffres + 23 lettres = 31.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
