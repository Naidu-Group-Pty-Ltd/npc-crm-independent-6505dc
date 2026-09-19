import { PropertyListing } from '@/lib/airtable';

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
  metadata?: Record<string, any>;
}

export interface ChartData {
  title: string;
  type: 'bar' | 'pie' | 'line' | 'scatter';
  data: ChartDataPoint[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  description?: string;
}

/**
 * Unified chart data generation service to ensure consistency
 * between dashboard and reports
 */
class ChartDataService {
  
  /**
   * Generate suburb distribution chart data
   */
  generateSuburbData(listings: PropertyListing[], limit: number = 10): ChartData {
    const suburbCounts = listings.reduce((acc, listing) => {
      const suburb = this.standardizeSuburb(listing.suburb || listing.location || 'Unknown');
      acc[suburb] = (acc[suburb] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const sortedData = Object.entries(suburbCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([suburb, count]) => ({
        label: suburb,
        value: count,
        color: this.getColorForIndex(0),
        metadata: { suburb }
      }));

    return {
      title: 'Listings by Suburb',
      type: 'bar',
      data: sortedData,
      xAxisLabel: 'Suburb',
      yAxisLabel: 'Number of Listings',
      description: `Top ${limit} suburbs by listing count`
    };
  }

  /**
   * Generate property type distribution chart data
   */
  generatePropertyTypeData(listings: PropertyListing[]): ChartData {
    const typeCounts = listings.reduce((acc, listing) => {
      const type = this.standardizePropertyType(listing.propertyType || 'Unknown');
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const data = Object.entries(typeCounts)
      .sort(([,a], [,b]) => b - a)
      .map(([type, count], index) => ({
        label: type,
        value: count,
        color: this.getColorForIndex(index),
        metadata: { propertyType: type }
      }));

    return {
      title: 'Property Type Distribution',
      type: 'pie',
      data,
      description: 'Breakdown of listings by property type'
    };
  }

  /**
   * Generate price range distribution chart data
   */
  generatePriceRangeData(listings: PropertyListing[]): ChartData {
    const ranges = [
      { label: 'Under $300k', min: 0, max: 300000 },
      { label: '$300k-$500k', min: 300000, max: 500000 },
      { label: '$500k-$750k', min: 500000, max: 750000 },
      { label: '$750k-$1M', min: 750000, max: 1000000 },
      { label: '$1M-$1.5M', min: 1000000, max: 1500000 },
      { label: 'Over $1.5M', min: 1500000, max: Infinity }
    ];

    const data = ranges.map((range, index) => {
      const count = listings.filter(listing => {
        const price = listing.price || 0;
        return price >= range.min && price < range.max;
      }).length;

      return {
        label: range.label,
        value: count,
        color: this.getColorForIndex(index),
        metadata: { priceRange: range }
      };
    }).filter(item => item.value > 0);

    return {
      title: 'Price Range Distribution',
      type: 'bar',
      data,
      xAxisLabel: 'Price Range',
      yAxisLabel: 'Number of Listings',
      description: 'Distribution of listings across price brackets'
    };
  }

  /**
   * Generate bedroom distribution chart data
   */
  generateBedroomData(listings: PropertyListing[]): ChartData {
    const bedroomCounts = listings.reduce((acc, listing) => {
      const beds = listing.beds || listing.bedrooms || 0;
      const bedKey = beds === 0 ? 'Unknown' : `${beds} bed${beds !== 1 ? 's' : ''}`;
      acc[bedKey] = (acc[bedKey] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const data = Object.entries(bedroomCounts)
      .sort(([a], [b]) => {
        if (a === 'Unknown') return 1;
        if (b === 'Unknown') return -1;
        const aNum = parseInt(a);
        const bNum = parseInt(b);
        return aNum - bNum;
      })
      .map(([beds, count], index) => ({
        label: beds,
        value: count,
        color: this.getColorForIndex(index),
        metadata: { bedrooms: beds }
      }));

    return {
      title: 'Bedroom Distribution',
      type: 'bar',
      data,
      xAxisLabel: 'Number of Bedrooms',
      yAxisLabel: 'Number of Listings',
      description: 'Distribution of listings by bedroom count'
    };
  }

  /**
   * Generate daily listing activity chart data
   */
  generateDailyActivityData(listings: PropertyListing[], days: number = 30): ChartData {
    const now = new Date();
    const dailyCounts: Record<string, number> = {};

    // Initialize all days with 0
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      dailyCounts[dateStr] = 0;
    }

    // Count listings by day
    listings.forEach(listing => {
      const dateStr = this.getListingDate(listing);
      if (dateStr && dailyCounts.hasOwnProperty(dateStr)) {
        dailyCounts[dateStr]++;
      }
    });

    const data = Object.entries(dailyCounts)
      .map(([date, count]) => ({
        label: this.formatDateLabel(date),
        value: count,
        color: this.getColorForIndex(0),
        metadata: { date, fullDate: date }
      }));

    return {
      title: 'Daily Listing Activity',
      type: 'line',
      data,
      xAxisLabel: 'Date',
      yAxisLabel: 'Number of Listings',
      description: `Listing activity over the last ${days} days`
    };
  }

  /**
   * Generate agency performance chart data
   */
  generateAgencyData(listings: PropertyListing[], limit: number = 10): ChartData {
    const agencyCounts = listings.reduce((acc, listing) => {
      const agency = listing.agencyName || 'Unknown Agency';
      acc[agency] = (acc[agency] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const data = Object.entries(agencyCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([agency, count], index) => ({
        label: this.truncateLabel(agency, 20),
        value: count,
        color: this.getColorForIndex(index),
        metadata: { agency, fullName: agency }
      }));

    return {
      title: 'Top Agencies by Listing Volume',
      type: 'bar',
      data,
      xAxisLabel: 'Agency',
      yAxisLabel: 'Number of Listings',
      description: `Top ${limit} agencies by listing count`
    };
  }

  /**
   * Generate source distribution chart data
   */
  generateSourceData(listings: PropertyListing[], limit: number = 10): ChartData {
    const sourceCounts = listings.reduce((acc, listing) => {
      const source = this.extractDomain(listing.source || 'Unknown');
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const data = Object.entries(sourceCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([source, count], index) => ({
        label: source,
        value: count,
        color: this.getColorForIndex(index),
        metadata: { source }
      }));

    return {
      title: 'Data Sources',
      type: 'pie',
      data,
      description: `Top ${limit} data sources by listing count`
    };
  }

  /**
   * Generate confidence distribution chart data
   */
  generateConfidenceData(listings: PropertyListing[]): ChartData {
    const ranges = [
      { label: 'Low (0-0.6)', min: 0, max: 0.6 },
      { label: 'Medium (0.6-0.8)', min: 0.6, max: 0.8 },
      { label: 'High (0.8-0.9)', min: 0.8, max: 0.9 },
      { label: 'Very High (0.9-1.0)', min: 0.9, max: 1.0 }
    ];

    const data = ranges.map((range, index) => {
      const count = listings.filter(listing => {
        const confidence = listing.confidence || 0;
        return confidence >= range.min && confidence < range.max;
      }).length;

      return {
        label: range.label,
        value: count,
        color: this.getColorForIndex(index),
        metadata: { confidenceRange: range }
      };
    }).filter(item => item.value > 0);

    return {
      title: 'Data Confidence Distribution',
      type: 'bar',
      data,
      xAxisLabel: 'Confidence Level',
      yAxisLabel: 'Number of Listings',
      description: 'Distribution of listings by data confidence score'
    };
  }

  // Helper methods

  private standardizeSuburb(suburb: string): string {
    return suburb
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private standardizePropertyType(type: string): string {
    const normalized = type.toLowerCase().trim();
    
    if (normalized.includes('house') || normalized.includes('home')) return 'House';
    if (normalized.includes('apartment') || normalized.includes('unit')) return 'Apartment';
    if (normalized.includes('townhouse') || normalized.includes('town house')) return 'Townhouse';
    if (normalized.includes('villa')) return 'Villa';
    if (normalized.includes('duplex')) return 'Duplex';
    if (normalized.includes('land') || normalized.includes('lot')) return 'Land';
    
    return type;
  }

  private getListingDate(listing: PropertyListing): string | null {
    const date = listing.receivedAt || listing.createdAt || listing.createdTime || listing.listingDate;
    if (!date) return null;
    
    try {
      const validDate = date instanceof Date ? date : new Date(date);
      if (isNaN(validDate.getTime())) return null;
      return validDate.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  private formatDateLabel(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  private extractDomain(source: string): string {
    if (source.includes('@')) {
      return source.split('@')[1] || source;
    }
    return source;
  }

  private truncateLabel(label: string, maxLength: number): string {
    return label.length > maxLength ? label.substring(0, maxLength) + '...' : label;
  }

  private getColorForIndex(index: number): string {
    const colors = [
      'hsl(var(--chart-1))',
      'hsl(var(--chart-2))',
      'hsl(var(--chart-3))',
      'hsl(var(--chart-4))',
      'hsl(var(--chart-5))',
      'hsl(var(--chart-6))',
      'hsl(var(--chart-7))',
      'hsl(var(--chart-8))',
      'hsl(var(--chart-9))',
      'hsl(var(--chart-10))'
    ];
    return colors[index % colors.length];
  }
}

export const chartDataService = new ChartDataService();