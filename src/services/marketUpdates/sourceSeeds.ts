import type { MarketSourceSeed } from '@/types/marketUpdates';
export const marketSourceSeeds: MarketSourceSeed[] = [
  {
    "source_key": "cotality_australia",
    "display_name": "Cotality Australia",
    "description": "Cotality Australia public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.cotality.com/au/insights",
    "feed_urls": [],
    "listing_urls": [
      "https://www.cotality.com/au/insights",
      "https://www.cotality.com/research-news"
    ],
    "source_authority": "specialist_data",
    "reliability_tier": "partner",
    "default_segments": [
      "property",
      "rental",
      "construction",
      "economic"
    ],
    "default_category": "property_market",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 180,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "proptrack_rea",
    "display_name": "realestate.com.au / PropTrack",
    "description": "realestate.com.au / PropTrack public market intelligence metadata.",
    "adapter_type": "feed_with_html_fallback",
    "primary_url": "https://www.realestate.com.au/news/feed/",
    "feed_urls": [
      "https://www.realestate.com.au/news/feed/"
    ],
    "listing_urls": [
      "https://www.realestate.com.au/insights/",
      "https://www.realestate.com.au/news/",
      "https://www.proptrack.com.au/insights-hub/insights/"
    ],
    "source_authority": "specialist_data",
    "reliability_tier": "partner",
    "default_segments": [
      "property",
      "rental",
      "economic",
      "finance"
    ],
    "default_category": "property_market",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 120,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "abc_business",
    "display_name": "ABC News Business",
    "description": "ABC News Business public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.abc.net.au/news/business",
    "feed_urls": [],
    "listing_urls": [
      "https://www.abc.net.au/news/business",
      "https://www.abc.net.au/news/topic/business-economics-and-finance"
    ],
    "source_authority": "tier_1_media",
    "reliability_tier": "tier_1_media",
    "default_segments": [
      "economic",
      "political",
      "finance",
      "property",
      "policy_regulation",
      "social"
    ],
    "default_category": "economy",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 60,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "reuters_australia",
    "display_name": "Reuters Australia / Asia-Pacific",
    "description": "Reuters Australia / Asia-Pacific public market intelligence metadata.",
    "adapter_type": "html_listing_or_licensed_feed",
    "primary_url": "https://www.reuters.com/world/asia-pacific/",
    "feed_urls": [],
    "listing_urls": [
      "https://www.reuters.com/world/asia-pacific/"
    ],
    "source_authority": "tier_1_media",
    "reliability_tier": "tier_1_media",
    "default_segments": [
      "economic",
      "finance",
      "political",
      "property",
      "policy_regulation"
    ],
    "default_category": "economy",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 60,
    "enabled": true,
    "copyright_mode": "link_and_metadata_only_unless_licensed",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "domain_research",
    "display_name": "Domain Research and News",
    "description": "Domain Research and News public market intelligence metadata.",
    "adapter_type": "feed_with_html_fallback",
    "primary_url": "https://www.domain.com.au/news/feed/",
    "feed_urls": [
      "https://www.domain.com.au/news/feed/"
    ],
    "listing_urls": [
      "https://www.domain.com.au/research/",
      "https://www.domain.com.au/news/national/",
      "https://www.domain.com.au/news/author/domain-research/",
      "https://www.domain.com.au/group/newsroom/media-releases/"
    ],
    "source_authority": "specialist_data",
    "reliability_tier": "partner",
    "default_segments": [
      "property",
      "rental",
      "finance",
      "economic",
      "policy_regulation"
    ],
    "default_category": "property_market",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 180,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "broker_daily",
    "display_name": "Broker Daily",
    "description": "Broker Daily public market intelligence metadata.",
    "adapter_type": "feed_with_html_fallback",
    "primary_url": "https://www.brokerdaily.au/feed/",
    "feed_urls": [
      "https://www.brokerdaily.au/feed/"
    ],
    "listing_urls": [
      "https://www.brokerdaily.au/",
      "https://www.brokerdaily.au/lender",
      "https://www.brokerdaily.au/regulation",
      "https://www.brokerdaily.au/property",
      "https://www.brokerdaily.au/economy"
    ],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": [
      "finance",
      "property",
      "policy_regulation",
      "economic"
    ],
    "default_category": "finance",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 60,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "urban_developer",
    "display_name": "The Urban Developer",
    "description": "The Urban Developer public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.theurbandeveloper.com/articles/top-stories",
    "feed_urls": [],
    "listing_urls": [
      "https://www.theurbandeveloper.com/articles/top-stories",
      "https://www.theurbandeveloper.com/"
    ],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": [
      "construction",
      "property",
      "political",
      "economic",
      "policy_regulation"
    ],
    "default_category": "construction",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 120,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "mortgage_professional_australia",
    "display_name": "Mortgage Professional Australia",
    "description": "Mortgage Professional Australia public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.mpamag.com/au/mortgage-industry/market-updates",
    "feed_urls": [],
    "listing_urls": [
      "https://www.mpamag.com/au/mortgage-industry/market-updates",
      "https://www.mpamag.com/au/news/general",
      "https://www.mpamag.com/au/mortgage-industry/industry-trends"
    ],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": [
      "finance",
      "property",
      "economic",
      "policy_regulation"
    ],
    "default_category": "finance",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 90,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "guardian_australia",
    "display_name": "The Guardian Australia",
    "description": "The Guardian Australia public market intelligence metadata.",
    "adapter_type": "rss",
    "primary_url": "https://www.theguardian.com/au/rss",
    "feed_urls": [
      "https://www.theguardian.com/au/rss",
      "https://www.theguardian.com/australia-news/business-australia/rss"
    ],
    "listing_urls": [
      "https://www.theguardian.com/australia-news/business-australia"
    ],
    "source_authority": "tier_1_media",
    "reliability_tier": "tier_1_media",
    "default_segments": [
      "political",
      "economic",
      "social",
      "property",
      "rental",
      "policy_regulation"
    ],
    "default_category": "political",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 60,
    "enabled": true,
    "copyright_mode": "rss_excerpt_and_transformative_summary",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "property_council_australia",
    "display_name": "Property Council of Australia / Property Australia",
    "description": "Property Council of Australia / Property Australia public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.propertycouncil.com.au/news-research/property-australia",
    "feed_urls": [],
    "listing_urls": [
      "https://www.propertycouncil.com.au/news-research/property-australia",
      "https://www.propertycouncil.com.au/news-research/overview"
    ],
    "source_authority": "industry_advocacy",
    "reliability_tier": "industry",
    "default_segments": [
      "property",
      "construction",
      "political",
      "policy_regulation",
      "economic"
    ],
    "default_category": "planning_supply",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 240,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": "industry_advocacy",
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "parliament_australia",
    "display_name": "Parliament of Australia",
    "description": "Parliament of Australia public market intelligence metadata.",
    "adapter_type": "rss_multi",
    "primary_url": "https://parlinfo.aph.gov.au/parlInfo/feeds/rss.w3p;adv=yes;orderBy=date-eFirst;page=0;query=Date%3AthisYear%20Dataset%3Abillsdgs;resCount=100",
    "feed_urls": [
      "https://parlinfo.aph.gov.au/parlInfo/feeds/rss.w3p;adv=yes;orderBy=date-eFirst;page=0;query=Date%3AthisYear%20Dataset%3Abillsdgs;resCount=100",
      "https://www.aph.gov.au/senate/rss/new_inquiries",
      "https://www.aph.gov.au/senate/rss/reports",
      "https://www.aph.gov.au/house/rss/house_inquiries",
      "https://www.aph.gov.au/house/rss/joint_inquiries",
      "https://www.aph.gov.au/house/rss/media_releases"
    ],
    "listing_urls": [
      "https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation"
    ],
    "source_authority": "primary_government",
    "reliability_tier": "official",
    "default_segments": [
      "political",
      "policy_regulation",
      "finance",
      "property",
      "construction",
      "economic"
    ],
    "default_category": "policy_regulation",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 60,
    "enabled": true,
    "copyright_mode": "public_sector_metadata_and_summary",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "federal_register_legislation",
    "display_name": "Federal Register of Legislation",
    "description": "Federal Register of Legislation public market intelligence metadata.",
    "adapter_type": "official_api",
    "primary_url": "https://api.prod.legislation.gov.au/v1/",
    "feed_urls": [],
    "listing_urls": [
      "https://api.prod.legislation.gov.au/swagger/index.html"
    ],
    "source_authority": "primary_legal",
    "reliability_tier": "official",
    "default_segments": [
      "policy_regulation",
      "political",
      "finance",
      "property",
      "construction",
      "economic"
    ],
    "default_category": "policy_regulation",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 120,
    "enabled": false,
    "copyright_mode": "public_sector_metadata_and_summary",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false,
      "disabled_reason": "Documented Federal Register API resource configuration is required before automated ingestion."
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "the_adviser_australia",
    "display_name": "The Adviser",
    "description": "The Adviser public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.theadviser.com.au/",
    "feed_urls": [],
    "listing_urls": [
      "https://www.theadviser.com.au/",
      "https://www.theadviser.com.au/lender",
      "https://www.theadviser.com.au/breaking-news"
    ],
    "source_authority": "specialist_industry_media",
    "reliability_tier": "industry",
    "default_segments": [
      "finance",
      "property",
      "policy_regulation",
      "economic"
    ],
    "default_category": "finance",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 60,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "mfaa",
    "display_name": "Mortgage & Finance Association of Australia",
    "description": "Mortgage & Finance Association of Australia public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.mfaa.com.au/news",
    "feed_urls": [],
    "listing_urls": [
      "https://www.mfaa.com.au/news",
      "https://www.mfaa.com.au/about/media-releases"
    ],
    "source_authority": "industry_association",
    "reliability_tier": "industry",
    "default_segments": [
      "finance",
      "policy_regulation",
      "property",
      "economic"
    ],
    "default_category": "finance",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 180,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": "industry_advocacy",
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "australian_banking_association",
    "display_name": "Australian Banking Association",
    "description": "Australian Banking Association public market intelligence metadata.",
    "adapter_type": "feed_with_html_fallback",
    "primary_url": "https://www.ausbanking.org.au/feed/",
    "feed_urls": [
      "https://www.ausbanking.org.au/feed/"
    ],
    "listing_urls": [
      "https://www.ausbanking.org.au/news/",
      "https://www.ausbanking.org.au/news-resources/media-releases/"
    ],
    "source_authority": "industry_association",
    "reliability_tier": "industry",
    "default_segments": [
      "finance",
      "policy_regulation",
      "economic",
      "political"
    ],
    "default_category": "finance",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 120,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": "banking_industry_advocacy",
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "austrac",
    "display_name": "AUSTRAC",
    "description": "AUSTRAC public market intelligence metadata.",
    "adapter_type": "rss_with_html_fallback",
    "primary_url": "https://www.austrac.gov.au/media-release/rss.xml",
    "feed_urls": [
      "https://www.austrac.gov.au/media-release/rss.xml"
    ],
    "listing_urls": [
      "https://www.austrac.gov.au/news-and-media/news-and-media-releases",
      "https://www.austrac.gov.au/news-and-media/media-release",
      "https://www.austrac.gov.au/industry-and-business/consultations"
    ],
    "source_authority": "regulator",
    "reliability_tier": "official",
    "default_segments": [
      "policy_regulation",
      "finance",
      "property",
      "political"
    ],
    "default_category": "policy_regulation",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 120,
    "enabled": true,
    "copyright_mode": "public_sector_metadata_and_summary",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "allens_legal_insights",
    "display_name": "Allens Legal Insights",
    "description": "Allens Legal Insights public market intelligence metadata.",
    "adapter_type": "rss",
    "primary_url": "https://feeds.feedburner.com/AllensLatestPublications",
    "feed_urls": [
      "https://feeds.feedburner.com/AllensLatestPublications",
      "https://feeds.feedburner.com/Allenspublicationsandmediareleases"
    ],
    "listing_urls": [
      "https://www.allens.com.au/insights-news/"
    ],
    "source_authority": "legal_interpretation",
    "reliability_tier": "industry",
    "default_segments": [
      "policy_regulation",
      "finance",
      "property",
      "construction",
      "economic"
    ],
    "default_category": "policy_regulation",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 240,
    "enabled": true,
    "copyright_mode": "rss_excerpt_and_transformative_summary",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": "legal_commentary_not_primary_law",
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "afca",
    "display_name": "Australian Financial Complaints Authority",
    "description": "Australian Financial Complaints Authority public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.afca.org.au/news/latest-news",
    "feed_urls": [],
    "listing_urls": [
      "https://www.afca.org.au/news/latest-news",
      "https://www.afca.org.au/news/media-releases"
    ],
    "source_authority": "dispute_resolution_authority",
    "reliability_tier": "official",
    "default_segments": [
      "finance",
      "policy_regulation",
      "social"
    ],
    "default_category": "policy_regulation",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 240,
    "enabled": true,
    "copyright_mode": "public_metadata_and_summary",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "banking_code_compliance_committee",
    "display_name": "Banking Code Compliance Committee",
    "description": "Banking Code Compliance Committee public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://bankingcode.org.au/",
    "feed_urls": [],
    "listing_urls": [
      "https://bankingcode.org.au/",
      "https://bankingcode.org.au/resources/",
      "https://bankingcode.org.au/banks/guidance-notes/"
    ],
    "source_authority": "code_compliance_body",
    "reliability_tier": "official",
    "default_segments": [
      "finance",
      "policy_regulation",
      "social"
    ],
    "default_category": "policy_regulation",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 360,
    "enabled": true,
    "copyright_mode": "public_metadata_and_summary",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [],
    "perspective": null,
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  },
  {
    "source_key": "fbaa",
    "display_name": "Finance Brokers Association of Australasia",
    "description": "Finance Brokers Association of Australasia public market intelligence metadata.",
    "adapter_type": "html_listing",
    "primary_url": "https://www.fbaa.com.au/news-media/newshub/",
    "feed_urls": [],
    "listing_urls": [
      "https://www.fbaa.com.au/news-media/newshub/",
      "https://www.fbaa.com.au/news-media/brokernet/",
      "https://www.fbaa.com.au/news-media/broker-magazine/"
    ],
    "source_authority": "industry_association",
    "reliability_tier": "industry",
    "default_segments": [
      "finance",
      "policy_regulation",
      "property",
      "economic"
    ],
    "default_category": "finance",
    "default_geography": [
      "Australia"
    ],
    "refresh_frequency_minutes": 180,
    "enabled": true,
    "copyright_mode": "metadata_and_transformative_summary_only",
    "extraction_policy": {
      "metadata_only": true,
      "full_article": false
    },
    "source_weight": 1,
    "relevant_keywords": [
      "Australia",
      "property",
      "housing",
      "mortgage",
      "lending",
      "economy",
      "regulation"
    ],
    "excluded_keywords": [
      "awards",
      "competition winner"
    ],
    "perspective": "industry_advocacy",
    "adapter_config": {
      "item_selector": "article",
      "title_selector": "h2,h3",
      "link_selector": "a[href]",
      "date_selector": "time",
      "excerpt_selector": "p"
    }
  }
] as MarketSourceSeed[];
