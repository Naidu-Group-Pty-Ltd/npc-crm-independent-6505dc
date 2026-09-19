export interface MarketUpdateArticleFilters {
  category:string;
  geography:string;
  impact:string;
  audience:string;
}

export const DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS:MarketUpdateArticleFilters = {
  category:'all',
  geography:'all',
  impact:'all',
  audience:'all',
};

export function hasClearableMarketUpdateFilters(search:string,source:string,filters:MarketUpdateArticleFilters):boolean {
  return Boolean(search.trim()) || source !== 'all' || Object.values(filters).some(value => value !== 'all');
}

export function clearMarketUpdateArticleFilters() {
  return { search:'', source:'all', filters:{...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS} };
}
