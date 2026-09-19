import type { MarketSourceAdapter,SourceConfig } from './types.ts'; import {RssAtomAdapter} from './rssAtom.ts'; import {HtmlListingAdapter} from './htmlListing.ts'; import {FederalLegislationApiAdapter} from './officialApi.ts';
class UnavailableAdapter implements MarketSourceAdapter{constructor(private reason:string){}async validate(){return{valid:false,format:'manual',itemCount:0,safeError:this.reason}}async fetch(){throw new Error(this.reason)}}
// `licensed_api` sources carry no fetchable endpoint at all until a redistribution
// agreement and its credentials exist, so they resolve to an adapter that fails
// loudly rather than one that silently scrapes the public website instead.
export class LicensedPartnerAdapter extends UnavailableAdapter{constructor(){super('Licensed partner credentials are not configured')}} export class ManualAdapter extends UnavailableAdapter{constructor(){super('Manual sources are not fetched automatically')}}
export function adapterFor(s:SourceConfig):MarketSourceAdapter{if(['rss','atom','rss_multi'].includes(s.adapter_type))return new RssAtomAdapter();if(['html_listing'].includes(s.adapter_type))return new HtmlListingAdapter();if(s.adapter_type==='official_api')return new FederalLegislationApiAdapter();if(['licensed_partner_feed','licensed_api'].includes(s.adapter_type))return new LicensedPartnerAdapter();return new ManualAdapter()}
export {RssAtomAdapter,HtmlListingAdapter,FederalLegislationApiAdapter}; export type * from './types.ts';
