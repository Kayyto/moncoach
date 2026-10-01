// Mon Coach — recettes : assemblage des parties (data-recipes-part1.js à part6.js)
// doivent être chargées AVANT ce fichier.
const RECIPES = [...RECIPES_PART1, ...RECIPES_PART2, ...RECIPES_PART3, ...RECIPES_PART4, ...RECIPES_PART5, ...RECIPES_PART6];

// Recettes ajoutées par l'utilisateur via « ➕ Ajouter mes recettes » — mêmes champs
// que RECIPES, plus {custom:true, id}. Enregistrées/rechargées avec le reste des données.
let customRecipes = [];

// Corrections apportées par l'administrateur aux recettes PRÉ-CHARGÉES de
// l'app (celles du tableau RECIPES ci-dessus, qui ne peuvent normalement pas
// être modifiées puisqu'elles font partie du code source). Clé = nom exact de
// la recette pré-chargée, valeur = les champs corrigés (mêmes champs qu'une
// recette normale). Alimenté par le module "Groupe" plus bas dans le fichier
// (lecture publique, écriture réservée au compte administrateur).
let recipeOverrides = {};
let overriddenRecipesCache = null;
