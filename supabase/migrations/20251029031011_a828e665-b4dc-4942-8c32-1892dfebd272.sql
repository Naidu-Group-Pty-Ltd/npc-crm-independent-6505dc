-- Phase 2 Enhancement: Seed initial school data and create import helpers

-- Create function to seed sample school data for major Australian cities
CREATE OR REPLACE FUNCTION public.seed_sample_schools()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Clear existing sample data if any
  DELETE FROM public.schools_directory WHERE name LIKE '%Sample%';
  
  -- Insert NSW sample schools
  INSERT INTO public.schools_directory 
    (name, suburb, postcode, state, school_type, school_level, icsea_score, student_count, latitude, longitude, address)
  VALUES
    ('Sydney Girls High School', 'Surry Hills', '2010', 'NSW', 'Government', 'Secondary', 1165, 950, -33.8833, 151.2167, '631 Elizabeth St, Surry Hills NSW 2010'),
    ('North Sydney Boys High School', 'Crows Nest', '2065', 'NSW', 'Government', 'Secondary', 1158, 1200, -33.8267, 151.2019, '4 Willoughby Rd, Crows Nest NSW 2065'),
    ('Sydney Grammar School', 'Darlinghurst', '2010', 'NSW', 'Independent', 'Secondary', 1185, 1800, -33.8742, 151.2194, 'College St, Darlinghurst NSW 2010'),
    ('Newtown Public School', 'Newtown', '2042', 'NSW', 'Government', 'Primary', 1045, 650, -33.8981, 151.1786, '230 King St, Newtown NSW 2042'),
    ('Homebush West Public School', 'Homebush West', '2140', 'NSW', 'Government', 'Primary', 985, 450, -33.8592, 151.0694, '96 The Crescent, Homebush West NSW 2140')
  ON CONFLICT (name, postcode, state) DO NOTHING;
  
  -- Insert VIC sample schools
  INSERT INTO public.schools_directory 
    (name, suburb, postcode, state, school_type, school_level, icsea_score, student_count, latitude, longitude, address)
  VALUES
    ('Melbourne High School', 'South Yarra', '3141', 'VIC', 'Government', 'Secondary', 1170, 1400, -37.8397, 145.0064, 'Forrest Hill, South Yarra VIC 3141'),
    ('Mac.Robertson Girls High School', 'Melbourne', '3004', 'VIC', 'Government', 'Secondary', 1172, 900, -37.8318, 144.9806, 'Kings Way, Melbourne VIC 3004'),
    ('University High School', 'Parkville', '3052', 'VIC', 'Government', 'Secondary', 1125, 1800, -37.7892, 144.9536, 'Story St, Parkville VIC 3052'),
    ('Brunswick South Primary School', 'Brunswick South', '3055', 'VIC', 'Government', 'Primary', 1010, 550, -37.7600, 144.9600, 'Blyth St, Brunswick South VIC 3055'),
    ('Princes Hill Primary School', 'Princes Hill', '3054', 'VIC', 'Government', 'Primary', 1075, 420, -37.7833, 144.9667, '144 Pigdon St, Princes Hill VIC 3054')
  ON CONFLICT (name, postcode, state) DO NOTHING;
  
  -- Insert QLD sample schools
  INSERT INTO public.schools_directory 
    (name, suburb, postcode, state, school_type, school_level, icsea_score, student_count, latitude, longitude, address)
  VALUES
    ('Brisbane State High School', 'South Brisbane', '4101', 'QLD', 'Government', 'Secondary', 1135, 2400, -27.4833, 153.0167, 'Cordelia St, South Brisbane QLD 4101'),
    ('Brisbane Grammar School', 'Spring Hill', '4000', 'QLD', 'Independent', 'Secondary', 1180, 1700, -27.4628, 153.0275, 'Gregory Terrace, Spring Hill QLD 4000'),
    ('New Farm State School', 'New Farm', '4005', 'QLD', 'Government', 'Primary', 1095, 600, -27.4650, 153.0450, 'James St, New Farm QLD 4005'),
    ('Kelvin Grove State College', 'Kelvin Grove', '4059', 'QLD', 'Government', 'Combined', 1050, 2100, -27.4478, 152.9978, 'Musk Ave, Kelvin Grove QLD 4059'),
    ('Wilston State School', 'Wilston', '4051', 'QLD', 'Government', 'Primary', 1070, 580, -27.4378, 153.0189, 'Primrose St, Wilston QLD 4051')
  ON CONFLICT (name, postcode, state) DO NOTHING;
  
  -- Insert WA sample schools
  INSERT INTO public.schools_directory 
    (name, suburb, postcode, state, school_type, school_level, icsea_score, student_count, latitude, longitude, address)
  VALUES
    ('Perth Modern School', 'Subiaco', '6008', 'WA', 'Government', 'Secondary', 1160, 1300, -31.9522, 115.8306, '90 Roberts Rd, Subiaco WA 6008'),
    ('Christ Church Grammar School', 'Claremont', '6010', 'WA', 'Independent', 'Secondary', 1175, 1500, -31.9806, 115.7856, 'Queenslea Dr, Claremont WA 6010'),
    ('Mount Lawley Senior High School', 'Mount Lawley', '6050', 'WA', 'Government', 'Secondary', 1140, 1700, -31.9297, 115.8711, 'Woodsome St, Mount Lawley WA 6050'),
    ('North Cottesloe Primary School', 'North Cottesloe', '6011', 'WA', 'Government', 'Primary', 1125, 380, -31.9892, 115.7581, 'Eric St, North Cottesloe WA 6011'),
    ('City Beach Primary School', 'City Beach', '6015', 'WA', 'Government', 'Primary', 1110, 520, -31.9417, 115.7683, 'Wordsworth Ave, City Beach WA 6015')
  ON CONFLICT (name, postcode, state) DO NOTHING;
  
  -- Insert SA sample schools
  INSERT INTO public.schools_directory 
    (name, suburb, postcode, state, school_type, school_level, icsea_score, student_count, latitude, longitude, address)
  VALUES
    ('Adelaide High School', 'Adelaide', '5000', 'SA', 'Government', 'Secondary', 1125, 1400, -34.9239, 138.5953, 'West Terrace, Adelaide SA 5000'),
    ('Glenunga International High School', 'Glenunga', '5064', 'SA', 'Government', 'Secondary', 1145, 1200, -34.9403, 138.6467, '99 L''Estrange St, Glenunga SA 5064'),
    ('Norwood Primary School', 'Norwood', '5067', 'SA', 'Government', 'Primary', 1080, 450, -34.9206, 138.6331, '175 The Parade, Norwood SA 5067'),
    ('Burnside Primary School', 'Burnside', '5066', 'SA', 'Government', 'Primary', 1095, 580, -34.9394, 138.6417, 'Portrush Rd, Burnside SA 5066')
  ON CONFLICT (name, postcode, state) DO NOTHING;
  
  -- Insert ACT sample schools
  INSERT INTO public.schools_directory 
    (name, suburb, postcode, state, school_type, school_level, icsea_score, student_count, latitude, longitude, address)
  VALUES
    ('Canberra Grammar School', 'Red Hill', '2603', 'ACT', 'Independent', 'Secondary', 1165, 1400, -35.3206, 149.1189, 'Monaro Crescent, Red Hill ACT 2603'),
    ('Narrabundah College', 'Narrabundah', '2604', 'ACT', 'Government', 'Secondary', 1115, 950, -35.3356, 149.1494, 'Jerrabomberra Ave, Narrabundah ACT 2604'),
    ('Ainslie School', 'Ainslie', '2602', 'ACT', 'Government', 'Primary', 1100, 420, -35.2617, 149.1436, 'Donaldson St, Ainslie ACT 2602'),
    ('Campbell Primary School', 'Campbell', '2612', 'ACT', 'Government', 'Primary', 1085, 380, -35.2850, 149.1544, 'Treloar Crescent, Campbell ACT 2612')
  ON CONFLICT (name, postcode, state) DO NOTHING;
  
  RAISE NOTICE '✅ Successfully seeded % sample schools', (SELECT COUNT(*) FROM public.schools_directory);
END;
$$;

-- Create function to calculate statistics for seeded schools
CREATE OR REPLACE FUNCTION public.get_schools_statistics()
RETURNS TABLE (
  total_schools BIGINT,
  by_state JSONB,
  by_level JSONB,
  by_type JSONB,
  avg_icsea NUMERIC,
  total_students BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    COUNT(*) as total_schools,
    jsonb_object_agg(state, state_count) as by_state,
    jsonb_object_agg(school_level, level_count) as by_level,
    jsonb_object_agg(school_type, type_count) as by_type,
    ROUND(AVG(icsea_score)) as avg_icsea,
    SUM(student_count) as total_students
  FROM (
    SELECT 
      state,
      COUNT(*) as state_count,
      school_level,
      COUNT(*) as level_count,
      school_type,
      COUNT(*) as type_count,
      icsea_score,
      student_count
    FROM public.schools_directory
    GROUP BY state, school_level, school_type, icsea_score, student_count
  ) stats;
$$;

-- Seed the sample data immediately
SELECT public.seed_sample_schools();

-- Display statistics
SELECT * FROM public.get_schools_statistics();