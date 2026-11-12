// Guess a category from the description, so most expenses need no extra tap.

import type { Category } from "./types.ts";

const RULES: [Category, RegExp][] = [
  ["Groceries", /costco|walmart|superstore|save.?on|safeway|no ?frills|t ?& ?t|grocer|market|daiko|dollarama|food basics|whole ?foods|produce/i],
  ["Dining", /dinner|lunch|breakfast|brunch|restaurant|cafe|coffee|starbucks|tim ?hortons|pizza|sushi|bar|pub|boyz|takeout|doordash|uber ?eats|skip/i],
  ["Rent", /rent|lease|landlord/i],
  ["Utilities", /hydro|bc ?hydro|fortis|gas bill|electric|internet|wi-?fi|phone|rogers|telus|shaw|bell|water/i],
  ["Transport", /uber|lyft|taxi|evo|modo|compass|translink|gas\b|petro|esso|shell|chevron|parking|bus|train|ferry/i],
  ["Household", /ikea|canadian tire|home ?depot|cleaning|toilet|paper towel|detergent|furniture|amazon/i],
  ["Entertainment", /movie|cinema|netflix|spotify|disney|concert|game|tickets|bowling|cricket/i],
  ["Travel", /hotel|airbnb|flight|air ?canada|westjet|booking|hostel|trip/i],
];

export function guessCategory(description: string): Category {
  for (const [category, pattern] of RULES) if (pattern.test(description)) return category;
  return "Other";
}

export const CATEGORY_ICON: Record<Category, string> = {
  Groceries: "🛒", Dining: "🍽️", Rent: "🏠", Utilities: "💡", Transport: "🚗",
  Household: "🧺", Entertainment: "🎟️", Travel: "✈️", Other: "•",
};
