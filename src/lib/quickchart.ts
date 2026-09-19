import { invokeSecureFunction } from "@/lib/secureInvoke";
import type { PropertyListing } from "@/lib/airtable";

export interface ChartData {
  labels: string[];
  datasets: Array<{
    label?: string;
    data: number[];
    backgroundColor?: string | string[];
  }>;
}

export interface QuickChartConfig {
  type: string;
  data: ChartData;
  options?: any;
}

export interface ChartUrls {
  suburb_bar_url: string;
  property_type_pie_url: string;
  price_range_bar_url: string;
  bedroom_bar_url: string;
}

export class QuickChartService {
  private baseUrl = 'https://quickchart.io/chart';
  
  private encodeChart(config: QuickChartConfig, width = 600, height = 400): string {
    const params = new URLSearchParams({
      c: JSON.stringify(config),
      w: width.toString(),
      h: height.toString(),
      f: 'png'
    });
    return `${this.baseUrl}?${params.toString()}`;
  }

  async getChartTemplate(templateName: string) {
    const { data, error } = await invokeSecureFunction('manage-templates', {
      operation: 'list',
      table: 'chart_configurations',
      listOptions: {
        filters: { template_name: templateName },
        limit: 1
      }
    });
    
    if (error) throw new Error(error.message);
    const records = data?.records || [];
    if (records.length === 0) throw new Error(`Template not found: ${templateName}`);
    return records[0];
  }

  processSuburbData(listings: PropertyListing[]): ChartData {
    const suburbCounts = listings.reduce((acc, listing) => {
      const suburb = listing.suburb || 'Unknown';
      acc[suburb] = (acc[suburb] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const sortedSuburbs = Object.entries(suburbCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10); // Top 10 suburbs

    return {
      labels: sortedSuburbs.map(([suburb]) => suburb),
      datasets: [{
        label: 'Listings',
        data: sortedSuburbs.map(([,count]) => count),
        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316']
      }]
    };
  }

  processPropertyTypeData(listings: PropertyListing[]): ChartData {
    const typeCounts = listings.reduce((acc, listing) => {
      const type = listing.propertyType || 'Unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      labels: Object.keys(typeCounts),
      datasets: [{
        data: Object.values(typeCounts),
        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
      }]
    };
  }

  processPriceRangeData(listings: PropertyListing[]): ChartData {
    const ranges = [
      { label: 'Under $300k', min: 0, max: 300000 },
      { label: '$300k-$500k', min: 300000, max: 500000 },
      { label: '$500k-$750k', min: 500000, max: 750000 },
      { label: '$750k-$1M', min: 750000, max: 1000000 },
      { label: 'Over $1M', min: 1000000, max: Infinity }
    ];

    const rangeCounts = ranges.map(range => {
      return listings.filter(listing => {
        const price = listing.price || 0;
        return price >= range.min && price < range.max;
      }).length;
    });

    return {
      labels: ranges.map(r => r.label),
      datasets: [{
        label: 'Listings',
        data: rangeCounts,
        backgroundColor: '#3b82f6'
      }]
    };
  }

  processBedroomData(listings: PropertyListing[]): ChartData {
    const bedroomCounts = listings.reduce((acc, listing) => {
      const beds = listing.beds || 0;
      const key = beds > 5 ? '5+' : beds.toString();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const sortedBedrooms = ['1', '2', '3', '4', '5', '5+']
      .filter(key => bedroomCounts[key])
      .map(key => ({ label: key, count: bedroomCounts[key] || 0 }));

    return {
      labels: sortedBedrooms.map(item => item.label),
      datasets: [{
        label: 'Listings',
        data: sortedBedrooms.map(item => item.count),
        backgroundColor: '#10b981'
      }]
    };
  }

  async generateChartUrls(listings: PropertyListing[]): Promise<ChartUrls> {
    try {
      // Get chart templates
      const [suburbTemplate, propertyTypeTemplate, priceRangeTemplate, bedroomTemplate] = await Promise.all([
        this.getChartTemplate('suburb_volume'),
        this.getChartTemplate('property_type'),
        this.getChartTemplate('price_range'),
        this.getChartTemplate('bedroom_count')
      ]);

      // Process data
      const suburbData = this.processSuburbData(listings);
      const propertyTypeData = this.processPropertyTypeData(listings);
      const priceRangeData = this.processPriceRangeData(listings);
      const bedroomData = this.processBedroomData(listings);

      // Create chart configs
      const suburbConfig = {
        ...(suburbTemplate.quickchart_config as unknown as QuickChartConfig),
        data: suburbData
      };

      const propertyTypeConfig = {
        ...(propertyTypeTemplate.quickchart_config as unknown as QuickChartConfig),
        data: propertyTypeData
      };

      const priceRangeConfig = {
        ...(priceRangeTemplate.quickchart_config as unknown as QuickChartConfig),
        data: priceRangeData
      };

      const bedroomConfig = {
        ...(bedroomTemplate.quickchart_config as unknown as QuickChartConfig),
        data: bedroomData
      };

      // Generate URLs
      return {
        suburb_bar_url: this.encodeChart(suburbConfig),
        property_type_pie_url: this.encodeChart(propertyTypeConfig),
        price_range_bar_url: this.encodeChart(priceRangeConfig),
        bedroom_bar_url: this.encodeChart(bedroomConfig)
      };
    } catch (error) {
      console.error('Error generating chart URLs:', error);
      // Return placeholder URLs on error
      return {
        suburb_bar_url: 'https://quickchart.io/chart?c={type:"bar",data:{labels:["Error"],datasets:[{data:[0]}]}}',
        property_type_pie_url: 'https://quickchart.io/chart?c={type:"pie",data:{labels:["Error"],datasets:[{data:[0]}]}}',
        price_range_bar_url: 'https://quickchart.io/chart?c={type:"bar",data:{labels:["Error"],datasets:[{data:[0]}]}}',
        bedroom_bar_url: 'https://quickchart.io/chart?c={type:"bar",data:{labels:["Error"],datasets:[{data:[0]}]}}'
      };
    }
  }
}

export const quickChartService = new QuickChartService();