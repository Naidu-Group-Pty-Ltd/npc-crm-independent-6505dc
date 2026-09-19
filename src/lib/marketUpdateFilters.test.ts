import { describe,expect,it } from 'vitest';
import { clearMarketUpdateArticleFilters, DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS, hasClearableMarketUpdateFilters } from './marketUpdateFilters';

describe('Market Updates article filters',()=>{
  it('is inactive at the six target defaults',()=>{
    expect(hasClearableMarketUpdateFilters('','all',DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS)).toBe(false);
  });

  it.each([
    ['search','rates','all',{...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS}],
    ['source','','RBA',{...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS}],
    ['category','','all',{...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS,category:'finance'}],
    ['geography','','all',{...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS,geography:'NSW'}],
    ['impact','','all',{...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS,impact:'high'}],
    ['audience','','all',{...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS,audience:'investors'}],
  ])('activates for %s',(_label,search,source,filters)=>{
    expect(hasClearableMarketUpdateFilters(search,source,filters)).toBe(true);
  });

  it('returns only the six article-filter defaults',()=>{
    expect(clearMarketUpdateArticleFilters()).toEqual({ search:'',source:'all',filters:DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS });
    expect(clearMarketUpdateArticleFilters()).not.toHaveProperty('segment');
    expect(clearMarketUpdateArticleFilters()).not.toHaveProperty('freshness');
    expect(clearMarketUpdateArticleFilters()).not.toHaveProperty('workspaceTab');
  });
});
