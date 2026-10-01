// Mon Coach — vidéos YouTube de démonstration.
//
// Couverture volontairement partielle : seuls certains exercices/étirements
// ont une vidéo pour l'instant (34 exercices + 40 étirements). Les autres
// continuent d'afficher leur icône SVG (ICONS, dans data-core.js) sans
// bouton vidéo — c'est un comportement normal, pas une erreur. La
// couverture sera étendue progressivement (prochain lot : étirements
// restants, puis exercices de la base élargie).
//
// Clé = nom exact de l'exercice/étirement (champ "n" dans EXERCISES/
// STRETCHES, data-core.js). Valeur = identifiant de vidéo YouTube (11
// caractères, la partie après "v=" ou "youtu.be/" dans l'URL).
//
// Vidéos sélectionnées par recherche web (chaînes de coaching/fitness
// établies, format court, technique/démonstration). Quelques-unes restent
// à vérifier manuellement dans le temps (disponibilité, droits
// d'intégration) : voir la liste signalée séparément.

const EXERCISE_VIDEOS = {
  "Squat au poids du corps": "qnkbt-JYioM",
  "Fentes avant": "1Ac8Z0RyDX4",
  "Squat sauté": "YW3QivV4X10",
  "Soulevé de terre roumain (haltères)": "Iy3J5_qzUdo",
  "Hip thrust (poids du corps)": "zSAOw_kjRPE",
  "Kettlebell swing": "txvgVmyEhJ8",
  "Tractions": "7FvO7zKB43o",
  "Rowing haltère un bras": "X97Jxni1ofw",
  "Superman": "oEB5IHo2_K4",
  "Soulevé de terre": "gNdZuaYZz7E",
  "Pompes": "-lkv4E8Aymk",
  "Développé couché haltères": "HBXn_SAlPw0",
  "Écarté couché haltères": "1cTdiW6etsc",
  "Pompes diamant": "iwSJGfRLcCU",
  "Développé militaire haltères": "K5V7xyzVqUw",
  "Élévations latérales": "q_DYeb_daeY",
  "Pike push-up": "shEnAXgc9y4",
  "Squat à la barre": "Dr41gZwfTfM",
  "Développé couché barre": "pxls2vBxFVs",
  "Rowing à la barre": "_l5fXUdDxYw",
  "Curl biceps haltères": "8wvflicHXXw",
  "Curl marteau": "zJXzA7WUc30",
  "Dips triceps (sur banc)": "Jx00BIi-E28",
  "Extension triceps haltère": "TB_Idy--jaU",
  "Gainage (planche)": "hoPwUu8vvvw",
  "Crunch": "LEb7Juw9tMo",
  "Relevé de jambes au sol": "ce-DMxpDIf8",
  "Mountain climbers": "ixxk9Qfn61o",
  "Russian twist": "C_OjLWMNcqM",
  "Gainage latéral": "_H9lCamSHR0",
  "Burpees": "4YPWd8z090A",
  "Jumping jacks": "RKwqhOcHLbE",
  "Corde à sauter": "WMqHUCWuX7U",
  "Thrusters haltères": "ib9cu5ZTyWU",
};

const STRETCH_VIDEOS = {
  "Étirement des ischio-jambiers": "wEuAv8wOPVo",
  "Étirement du mollet debout (gastrocnémien)": "QasRqESLRnc",
  "Étirement des quadriceps": "4c5oLJxm2Nk",
  "Étirement des pectoraux, bras derrière la tête": "6pIDnFHUK8E",
  "Étirement de l'épaule": "v2G5HM5YMoo",
  "Étirement du chat (dos)": "3Ev8R-vGCcU",
  "Étirement du bas du dos sur chaise": "LOrCwWaf2q8",
  "Étirement des biceps debout": "3bN9i7j_xTU",
  "Étirement des triceps": "bgqcmGxFycc",
  "Étirement complet 'World's Greatest Stretch'": "V_iRWxBzh-k",
  "Étirement au-dessus de la tête": "_JGWt2BDCl4",
  "Étirement au-dessus de la tête assis": "aJBEW7a4ADc",
  "Étirement latéral debout": "LIhQaEDyY6Q",
  "Étirement de la bandelette ilio-tibiale et du fessier": "MO2ZNz03YEI",
  "Étirement de l'aine et du dos": "NAPOfCnC294",
  "Étirement de l'aine allongé sur le côté": "RS7_qfhRZ6c",
  "Étirement de l'avant-bras à genoux": "sUEBYCv3OZY",
  "Étirement dynamique du dos": "PGDnZ-sCC_o",
  "Étirement au sol allongé sur le côté": "Cf3I4EKLcOg",
  "Étirement du milieu du dos": "86BU0Be0Y24",
  "Étirement du haut du dos": "nMqlUEK1iis",
  "Étirement du haut du corps sur chaise": "uhRv-nq2_2M",
  "Étirement de l'épaule en cercle ('Round the World')": "klSShZ8WoPI",
  "Étirement de la jambe tendue sur chaise": "W9d98XmJJ1Y",
  "Étirement des ischio-jambiers jambe levée": "Il1L75v6gq0",
  "Étirement du coureur": "yqgsm8wzcJw",
  "Étirement des ischio-jambiers assis au sol": "oJX8EKF3TqM",
  "Étirement des ischio-jambiers et du mollet assis": "iPD_nUSdJ6o",
  "Étirement des ischio-jambiers et du mollet debout": "0r3qQUDArc8",
  "Étirement du mollet, coudes contre le mur": "6TgRW81LWjs",
  "Étirement du mollet, mains contre le mur": "pqewvQ9HJP0",
  "Étirement du mollet assis": "0YPe1-ml4NE",
  "Étirement des pectoraux et de l'avant de l'épaule": "Dmm8_S23I74",
  "Étirement des pectoraux sur ballon de stabilité": "kG9-5b1u1Qg",
  "Étirement dynamique des pectoraux": "u7AFpzWV2I8",
  "Étirement des quadriceps à quatre pattes": "sTX73bpw0w0",
  "Étirement des quadriceps sur le côté": "uRRwljV-Nlk",
  "Étirement des quadriceps allongé sur le dos": "gVuOj2Au5S8",
  "Étirement des quadriceps debout, jambe surélevée": "MF88t--IWoc",
  "Étirement des triceps sur le côté": "FdlvN9_Kxk4",
};
