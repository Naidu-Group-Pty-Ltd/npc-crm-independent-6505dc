export interface AirtableRecord {
  id: string;
  fields: {
    // Core fields
    'Record ID'?: number;
    'URL'?: string;
    'Source Host'?: string;
    'Hash'?: string;
    'MessageID'?: string;
    'Email Subject'?: string;
    'From'?: string;
    'ReceivedAt'?: string;
    
    // Listing fields
    'Address'?: string;
    'Suburb'?: string;
    'Property Type'?: 'House' | 'Apartment' | 'Townhouse' | 'Unit' | 'Villa' | 'Duplex' | 'Land' | 'Other';
    'Category'?: 'listing' | 'news' | 'spec_sheet' | 'job_post' | 'press_release' | 'report' | 'other';
    'Price'?: number;
    'Beds'?: number;
    'Baths'?: number;
    'Car Spaces'?: number;
    
    // Inspections
    'Inspection Start'?: string;
    'Inspection End'?: string;
    'Inspection Notes'?: string;
    
    // Agency
    'Agency Name'?: string;
    'Agent Name'?: string;
    'Agent Phone'?: string;
    
    // Media
    'Images'?: AirtableAttachment[];
    'Floorplans'?: AirtableAttachment[];
    
    // Quality/Meta
    'Summary'?: string;
    'Key Entities'?: string;
    'Confidence'?: number;
    'Raw Extract'?: string;
    
    // New fields
    'Created At'?: string;
    'Source'?: string;
    'Web Link'?: string;
  };
  createdTime: string;
}

export interface AirtableAttachment {
  id: string;
  url: string;
  filename: string;
  type?: string;
  size?: number;
  width?: number;
  height?: number;
  thumbnails?: {
    small?: { url: string; width: number; height: number };
    large?: { url: string; width: number; height: number };
    full?: { url: string; width: number; height: number };
  };
}

export interface AirtableResponse {
  records: AirtableRecord[];
  offset?: string;
}

export interface PropertyListing {
  id: string;
  recordId?: number;
  url?: string;
  sourceHost?: string;
  hash?: string;
  messageId?: string;
  emailSubject?: string;
  from?: string;
  receivedAt?: Date;
  address?: string;
  suburb?: string;
  propertyType?: string;
  category?: string;
  price?: number;
  beds?: number;
  baths?: number;
  carSpaces?: number;
  inspectionStart?: Date;
  inspectionEnd?: Date;
  inspectionNotes?: string;
  agencyName?: string;
  agentName?: string;
  agentPhone?: string;
  images?: AirtableAttachment[];
  floorplans?: AirtableAttachment[];
  summary?: string;
  keyEntities?: string;
  confidence?: number;
  rawExtract?: string;
  createdTime: Date;
  createdAt?: Date;
  source?: string;
  webLinks?: string;
}

export interface DashboardKPIs {
  newThisWeek: number;
  withInspections: number;
  needsReview: number;
  averagePrice: number;
}

export interface SuburbStats {
  suburb: string;
  count: number;
}

export interface PropertyTypeStats {
  type: string;
  count: number;
}

export interface DailyStats {
  date: string;
  count: number;
}