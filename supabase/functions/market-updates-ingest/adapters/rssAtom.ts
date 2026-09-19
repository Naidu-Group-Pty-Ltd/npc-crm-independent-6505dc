import { XMLParser, XMLValidator } from 'npm:fast-xml-parser@5.2.5';
import type { MarketSourceAdapter,NormalisedSourceBatch,NormalisedSourceItem,SourceConfig,SourceValidationResult } from './types.ts'; import { boundedFetch,normaliseUrl,safeSourceExcerpt,sourceDomains } from './security.ts';
const arr=<T>(v:T|T[]|undefined):T[]=>v===undefined?[]:Array.isArray(v)?v:[v]; const text=(v:unknown):string=>typeof v==='string'?v:typeof v==='number'?String(v):v&&typeof v==='object'&&'#text'in(v as object)?String((v as {'#text':unknown})['#text']):'';
const DEFAULT_RSS_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Aurixa-Market-Intelligence/2.0';
const rssUA=()=>{const e=Deno.env.get('MARKET_UPDATES_USER_AGENT');return e&&e.trim().length?e:DEFAULT_RSS_UA;};
// Aggregator feeds (Google News) append " - <publisher>" to every headline and carry the
// publisher in a <source> element. Strip only that exact literal so real titles containing
// a dash are untouched.
const stripFeedPublisherSuffix=(title:string,publisher:string):string=>{const p=(publisher??'').trim();if(!p)return title;const suffix=' - '+p;return title.endsWith(suffix)?title.slice(0,-suffix.length).trim()||title:title;};
const itemCap=()=>Number(Deno.env.get('MARKET_UPDATES_MAX_ITEMS_PER_SOURCE')||40);
export class RssAtomAdapter implements MarketSourceAdapter { async read(source:SourceConfig,url:string):Promise<NormalisedSourceBatch>{const allowed=sourceDomains(source);const {response,body,latency}=await boundedFetch(url,allowed,{headers:{accept:'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5','accept-language':'en-AU,en;q=0.9','user-agent':rssUA()}});
    // A BOM or stray whitespace ahead of the XML declaration is common in the wild
    // and makes an otherwise valid feed fail validation outright.
    const xml=body.replace(/^\uFEFF/,'').trimStart();
    if(XMLValidator.validate(xml)!==true)throw new Error('Invalid RSS/Atom XML');const doc=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',trimValues:true,processEntities:true}).parse(xml);const rss=doc.rss?.channel;const atom=doc.feed;
    // RSS 1.0 (RDF) keeps <item> at the document root rather than under a channel.
    // The RBA publishes all of its feeds this way.
    const rdf=doc['rdf:RDF']??doc.RDF;
    const nodes=rss?arr(rss.item):atom?arr(atom.entry):rdf?arr(rdf.item):[];const items:NormalisedSourceItem[]=nodes.slice(0,itemCap()).map((n:any)=>{const link=typeof n.link==='string'?n.link:arr(n.link).find((l:any)=>!l?.['@_rel']||l['@_rel']==='alternate')?.['@_href'];const raw=link||text(n.guid)||url;const canonical=normaliseUrl(raw,url,allowed);const date=text(n.pubDate)||text(n['dc:date'])||text(n.published)||text(n.updated);const parsed=date&&!Number.isNaN(Date.parse(date))?new Date(date).toISOString():null;return{externalId:text(n.guid)||text(n.id)||canonical,title:stripFeedPublisherSuffix(text(n.title).trim(),text(n.source)),canonicalUrl:canonical,originalUrl:raw,publishedAt:parsed,excerpt:safeSourceExcerpt(source,text(n.description)||text(n.summary)||text(n['content:encoded'])||text(n.content)||null),author:text(n.author?.name||n.author)||null,category:text(arr(n.category)[0])||null};}).filter(i=>i.title&&i.canonicalUrl);if(!items.length)throw new Error('Feed contained no parseable entries');return{items,validation:{valid:true,format:rss?'rss2':atom?'atom':'rss1',itemCount:items.length,endpoint:url,httpStatus:response.status,latencyMs:latency}}} async validate(source:SourceConfig):Promise<SourceValidationResult>{try{return(await this.read(source,source.feed_urls[0]||source.primary_url!)).validation}catch(e){return{valid:false,format:'unknown',itemCount:0,safeError:String((e as Error).message).slice(0,240)}}}
  async fetch(source:SourceConfig):Promise<NormalisedSourceBatch>{
    // `rss_multi` means the source publishes across several feeds, so read them all
    // and merge; every other feed type keeps first-success-wins semantics.
    if(source.adapter_type==='rss_multi'&&source.feed_urls.length>1){
      const batches:NormalisedSourceBatch[]=[];let last:Error|undefined;
      for(const url of source.feed_urls){try{batches.push(await this.read(source,url));}catch(e){last=e as Error;}}
      if(!batches.length)throw last||new Error('No feed configured');
      const merged=[...new Map(batches.flatMap(b=>b.items).map(i=>[i.canonicalUrl,i])).values()]
        .sort((a,b)=>(Date.parse(b.publishedAt??'')||0)-(Date.parse(a.publishedAt??'')||0))
        .slice(0,itemCap());
      return{items:merged,validation:{...batches[0].validation,itemCount:merged.length,fallbackUsed:batches.length<source.feed_urls.length,safeError:batches.length<source.feed_urls.length?String(last?.message??'').slice(0,240):undefined}};
    }
    let last:Error|undefined;for(const url of source.feed_urls){try{return await this.read(source,url)}catch(e){last=e as Error}}throw last||new Error('No feed configured')}}
