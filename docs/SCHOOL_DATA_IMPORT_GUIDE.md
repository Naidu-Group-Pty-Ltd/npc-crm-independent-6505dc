# School Data Import Guide

## Overview

This guide explains how to populate the `schools_directory` database with real Australian school data to maximize Phase 2 implementation.

## ✅ Current Status

**28 sample schools** have been seeded across all Australian states:
- NSW: 5 schools
- VIC: 5 schools  
- QLD: 5 schools
- WA: 5 schools
- SA: 4 schools
- ACT: 4 schools

Average ICSEA: **1116**  
Total Students: **29,680**

## 🔄 Import Methods

### Method 1: Bulk Import Edge Function

Use the `import-schools-data` edge function to import schools programmatically:

```typescript
// Example: Import schools via API call
const response = await supabase.functions.invoke('import-schools-data', {
  body: {
    schools: [
      {
        name: "Example Primary School",
        suburb: "Sydney",
        postcode: "2000",
        state: "NSW",
        school_type: "Government",
        school_level: "Primary",
        icsea_score: 1050,
        student_count: 450,
        latitude: -33.8688,
        longitude: 151.2093,
        address: "123 Example St, Sydney NSW 2000",
        website_url: "https://example.edu.au"
      }
    ],
    overwrite: false // Set to true to update existing schools
  }
});
```

**Features:**
- ✅ Validates all school data
- ✅ Prevents duplicates (by name + postcode + state)
- ✅ Option to overwrite existing records
- ✅ Returns detailed import summary

### Method 2: Direct SQL Import

For bulk CSV imports, use PostgreSQL's `COPY` command:

```sql
-- Create temporary table for CSV import
CREATE TEMP TABLE schools_import (
    name TEXT,
    suburb TEXT,
    postcode TEXT,
    state TEXT,
    school_type TEXT,
    school_level TEXT,
    icsea_score INTEGER,
    student_count INTEGER,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    address TEXT,
    website_url TEXT
);

-- Import CSV file
COPY schools_import FROM '/path/to/schools.csv' 
DELIMITER ',' CSV HEADER;

-- Insert into main table (skip duplicates)
INSERT INTO public.schools_directory 
    (name, suburb, postcode, state, school_type, school_level, 
     icsea_score, student_count, latitude, longitude, address, website_url)
SELECT * FROM schools_import
ON CONFLICT (name, postcode, state) DO NOTHING;

-- Drop temp table
DROP TABLE schools_import;
```

### Method 3: Manual Database Seeding

Re-run the seed function to restore sample data:

```sql
SELECT public.seed_sample_schools();
```

## 📥 Data Sources

### Official School Data Sources

**NSW Schools:**
- Source: NSW Department of Education
- API: `https://data.cese.nsw.gov.au/data/dataset/nsw-public-schools-master-dataset`
- Format: CSV/JSON
- Fields: School name, address, postcode, ICSEA, enrolments

**VIC Schools:**
- Source: Victorian Department of Education
- API: `https://discover.data.vic.gov.au/dataset/victorian-schools`
- Format: CSV/JSON
- Fields: School name, type, postcode, ICSEA

**QLD Schools:**
- Source: Queensland Department of Education
- API: `https://www.data.qld.gov.au/dataset/schools-directory`
- Format: CSV
- Fields: School name, suburb, postcode, sector, enrolments

**WA Schools:**
- Source: WA Department of Education
- API: `https://catalogue.data.wa.gov.au/dataset/school-locations`
- Format: CSV/Shapefile

**SA Schools:**
- Source: SA Department of Education
- API: `https://data.sa.gov.au/data/dataset/school-locations`
- Format: CSV

**ACARA (National):**
- Source: Australian Curriculum, Assessment and Reporting Authority
- Website: `https://www.myschool.edu.au`
- Note: No public API, but data available via data.gov.au

## 📊 CSV Format

Your CSV file should match this format:

```csv
name,suburb,postcode,state,school_type,school_level,icsea_score,student_count,latitude,longitude,address,website_url
"Sydney Girls High School","Surry Hills","2010","NSW","Government","Secondary",1165,950,-33.8833,151.2167,"631 Elizabeth St, Surry Hills NSW 2010","https://sydgirlshigh.nsw.edu.au"
"Melbourne High School","South Yarra","3141","VIC","Government","Secondary",1170,1400,-37.8397,145.0064,"Forrest Hill, South Yarra VIC 3141","https://www.mhs.vic.edu.au"
```

**Required Fields:**
- `name` (TEXT) - School name
- `suburb` (TEXT) - Suburb
- `postcode` (TEXT) - Postcode
- `state` (TEXT) - State code (NSW, VIC, QLD, etc.)

**Optional Fields:**
- `school_type` (TEXT) - Government, Catholic, Independent, Other
- `school_level` (TEXT) - Primary, Secondary, Combined, Special, Other
- `icsea_score` (INTEGER) - 500-1500
- `student_count` (INTEGER)
- `latitude` (DECIMAL)
- `longitude` (DECIMAL)
- `address` (TEXT)
- `website_url` (TEXT)

## 🔍 Querying School Data

### Get schools by postcode:
```sql
SELECT * FROM schools_directory 
WHERE postcode = '2010' AND state = 'NSW';
```

### Find schools within radius (5km):
```sql
SELECT 
    name,
    suburb,
    icsea_score,
    student_count,
    ST_Distance(
        ST_Point(longitude, latitude)::geography,
        ST_Point(151.2093, -33.8688)::geography
    ) / 1000 as distance_km
FROM schools_directory
WHERE state = 'NSW'
ORDER BY distance_km
LIMIT 10;
```

### Get statistics by state:
```sql
SELECT 
    state,
    COUNT(*) as total_schools,
    ROUND(AVG(icsea_score)) as avg_icsea,
    SUM(student_count) as total_students
FROM schools_directory
GROUP BY state
ORDER BY state;
```

## 📈 Monitoring

Check import statistics:

```sql
SELECT * FROM public.get_schools_statistics();
```

Returns:
- Total schools imported
- Breakdown by state
- Breakdown by school level
- Breakdown by school type
- Average ICSEA score
- Total student count

## 🔄 Updating Data

To refresh school data annually:

1. Download latest CSV from state education departments
2. Set `overwrite: true` in import function
3. Or use SQL `ON CONFLICT` clause to update existing records:

```sql
INSERT INTO schools_directory (...)
VALUES (...)
ON CONFLICT (name, postcode, state) 
DO UPDATE SET 
    icsea_score = EXCLUDED.icsea_score,
    student_count = EXCLUDED.student_count,
    last_updated = CURRENT_DATE;
```

## ⚠️ Important Notes

1. **ICSEA Scores**: Range from 500-1500, average is 1000
2. **Data Recency**: School data should be updated annually
3. **Privacy**: Student-level data should never be stored
4. **Coordinates**: Essential for distance calculations
5. **Duplicates**: Prevented by unique constraint on (name, postcode, state)

## 🎯 Next Steps

1. **Download Data**: Get CSV files from state education departments
2. **Format Data**: Match the CSV format above
3. **Import Data**: Use Method 1 or 2 to bulk import
4. **Verify**: Query database to confirm import success
5. **Test**: Generate investment reports to see real school data

## 📞 Support

For issues with data import, check:
- Edge function logs: `/functions/import-schools-data/logs`
- Database logs for constraint violations
- Data format matches required schema