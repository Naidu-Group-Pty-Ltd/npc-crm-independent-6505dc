import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyInternal, logSecurityEvent } from "../_shared/auth_v2.ts";
import { internalError } from '../_shared/errorResponse.ts';
const INTERNAL_EDGE_SECRET = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-webhook-secret',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

/** Constant-time string comparison (avoids leaking the secret via timing). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface ListingData {
  id: string;
  address?: string;
  propertyName?: string;  // OR alternative to address
  property_name?: string; // Snake case variant
  suburb?: string;
  propertyType?: string;
  category?: string;
  price?: number;
  beds?: number;
  baths?: number;
  confidence?: number;
  sourceHost?: string;
  state?: string;
  zipcode?: string;  // Some Airtable records use zipcode instead of postcode
  postcode?: string; // Standard Australian postcode field
}

interface SwitchCriteria {
  propertyTypes?: string[];
  priceMin?: number | null;
  priceMax?: number | null;
  bedsMin?: number | null;
  bedsMax?: number | null;
  bathsMin?: number | null;
  bathsMax?: number | null;
  states?: string[];
  categories?: string[];
  confidenceMin?: number | null;
  hasPrice?: boolean | null;
  sourceHosts?: string[];
}

interface AutoReportSwitch {
  id: string;
  name: string;
  is_enabled: boolean;
  priority: number;
  criteria: SwitchCriteria;
}

// Common Australian suburbs with their states and postcodes (fallback lookup)
const SUBURB_LOOKUP: Record<string, { state: string; postcode: string }> = {
  // ========== QLD SUBURBS ==========
  // Major Cities
  'BRISBANE': { state: 'QLD', postcode: '4000' },
  'GOLD COAST': { state: 'QLD', postcode: '4217' },
  'SURFERS PARADISE': { state: 'QLD', postcode: '4217' },
  'CAIRNS': { state: 'QLD', postcode: '4870' },
  'TOWNSVILLE': { state: 'QLD', postcode: '4810' },
  'TOOWOOMBA': { state: 'QLD', postcode: '4350' },
  'ROCKHAMPTON': { state: 'QLD', postcode: '4700' },
  'MACKAY': { state: 'QLD', postcode: '4740' },
  'BUNDABERG': { state: 'QLD', postcode: '4670' },
  'HERVEY BAY': { state: 'QLD', postcode: '4655' },
  'GLADSTONE': { state: 'QLD', postcode: '4680' },
  // Sunshine Coast
  'NOOSA': { state: 'QLD', postcode: '4567' },
  'CALOUNDRA': { state: 'QLD', postcode: '4551' },
  'MAROOCHYDORE': { state: 'QLD', postcode: '4558' },
  'MOOLOOLABA': { state: 'QLD', postcode: '4557' },
  'NAMBOUR': { state: 'QLD', postcode: '4560' },
  'BUDERIM': { state: 'QLD', postcode: '4556' },
  // Brisbane Metro
  'IPSWICH': { state: 'QLD', postcode: '4305' },
  'SPRINGFIELD': { state: 'QLD', postcode: '4300' },
  'LOGAN': { state: 'QLD', postcode: '4114' },
  'REDLAND BAY': { state: 'QLD', postcode: '4165' },
  'CABOOLTURE': { state: 'QLD', postcode: '4510' },
  'STRATHPINE': { state: 'QLD', postcode: '4500' },
  'REDCLIFFE': { state: 'QLD', postcode: '4020' },
  'MORETON BAY': { state: 'QLD', postcode: '4508' },
  'CHERMSIDE': { state: 'QLD', postcode: '4032' },
  'INDOOROOPILLY': { state: 'QLD', postcode: '4068' },
  'CARINDALE': { state: 'QLD', postcode: '4152' },
  'SOUTHBANK': { state: 'QLD', postcode: '4101' },
  'FORTITUDE VALLEY': { state: 'QLD', postcode: '4006' },
  'WEST END': { state: 'QLD', postcode: '4101' },
  'PADDINGTON': { state: 'QLD', postcode: '4064' },
  'ASCOT': { state: 'QLD', postcode: '4007' },
  'NEW FARM': { state: 'QLD', postcode: '4005' },
  'BULIMBA': { state: 'QLD', postcode: '4171' },
  // Regional QLD
  'GATTON': { state: 'QLD', postcode: '4343' },
  'WARWICK': { state: 'QLD', postcode: '4370' },
  'STANTHORPE': { state: 'QLD', postcode: '4380' },
  'DALBY': { state: 'QLD', postcode: '4405' },
  'KINGAROY': { state: 'QLD', postcode: '4610' },
  'GYMPIE': { state: 'QLD', postcode: '4570' },
  'MARYBOROUGH': { state: 'QLD', postcode: '4650' },
  'EMERALD': { state: 'QLD', postcode: '4720' },
  'LONGREACH': { state: 'QLD', postcode: '4730' },
  'MOUNT ISA': { state: 'QLD', postcode: '4825' },
  'CHARTERS TOWERS': { state: 'QLD', postcode: '4820' },
  'BOWEN': { state: 'QLD', postcode: '4805' },
  'PROSERPINE': { state: 'QLD', postcode: '4800' },
  'AIRLIE BEACH': { state: 'QLD', postcode: '4802' },
  'YEPPOON': { state: 'QLD', postcode: '4703' },
  'BILOELA': { state: 'QLD', postcode: '4715' },
  'ROMA': { state: 'QLD', postcode: '4455' },
  'CHINCHILLA': { state: 'QLD', postcode: '4413' },
  'MILES': { state: 'QLD', postcode: '4415' },
  'GOONDIWINDI': { state: 'QLD', postcode: '4390' },
  'BEAUDESERT': { state: 'QLD', postcode: '4285' },
  'BOONAH': { state: 'QLD', postcode: '4310' },
  'LAIDLEY': { state: 'QLD', postcode: '4341' },
  'ESK': { state: 'QLD', postcode: '4312' },
  'KILCOY': { state: 'QLD', postcode: '4515' },
  'MALENY': { state: 'QLD', postcode: '4552' },
  'MONTVILLE': { state: 'QLD', postcode: '4560' },
  'COOROY': { state: 'QLD', postcode: '4563' },
  'TEWANTIN': { state: 'QLD', postcode: '4565' },
  'POMONA': { state: 'QLD', postcode: '4568' },
  'KENILWORTH': { state: 'QLD', postcode: '4574' },
  'ATHERTON': { state: 'QLD', postcode: '4883' },
  'MAREEBA': { state: 'QLD', postcode: '4880' },
  'INNISFAIL': { state: 'QLD', postcode: '4860' },
  'TULLY': { state: 'QLD', postcode: '4854' },
  'MISSION BEACH': { state: 'QLD', postcode: '4852' },
  'PORT DOUGLAS': { state: 'QLD', postcode: '4877' },
  'MOSSMAN': { state: 'QLD', postcode: '4873' },
  'AYR': { state: 'QLD', postcode: '4807' },
  'INGHAM': { state: 'QLD', postcode: '4850' },
  'SARINA': { state: 'QLD', postcode: '4737' },
  
  // ========== NSW SUBURBS ==========
  // Sydney Metro
  'SYDNEY': { state: 'NSW', postcode: '2000' },
  'PARRAMATTA': { state: 'NSW', postcode: '2150' },
  'PENRITH': { state: 'NSW', postcode: '2750' },
  'LIVERPOOL': { state: 'NSW', postcode: '2170' },
  'CAMPBELLTOWN': { state: 'NSW', postcode: '2560' },
  'BLACKTOWN': { state: 'NSW', postcode: '2148' },
  'CHATSWOOD': { state: 'NSW', postcode: '2067' },
  'MANLY': { state: 'NSW', postcode: '2095' },
  'BONDI': { state: 'NSW', postcode: '2026' },
  'COOGEE': { state: 'NSW', postcode: '2034' },
  'CRONULLA': { state: 'NSW', postcode: '2230' },
  'HURSTVILLE': { state: 'NSW', postcode: '2220' },
  'BANKSTOWN': { state: 'NSW', postcode: '2200' },
  'AUBURN': { state: 'NSW', postcode: '2144' },
  'RYDE': { state: 'NSW', postcode: '2112' },
  'HORNSBY': { state: 'NSW', postcode: '2077' },
  'CASTLE HILL': { state: 'NSW', postcode: '2154' },
  'BAULKHAM HILLS': { state: 'NSW', postcode: '2153' },
  'NORTH SYDNEY': { state: 'NSW', postcode: '2060' },
  'MOSMAN': { state: 'NSW', postcode: '2088' },
  'RANDWICK': { state: 'NSW', postcode: '2031' },
  'MAROUBRA': { state: 'NSW', postcode: '2035' },
  'SURRY HILLS': { state: 'NSW', postcode: '2010' },
  'NEWTOWN': { state: 'NSW', postcode: '2042' },
  'MARRICKVILLE': { state: 'NSW', postcode: '2204' },
  'LEICHHARDT': { state: 'NSW', postcode: '2040' },
  'STRATHFIELD': { state: 'NSW', postcode: '2135' },
  'BURWOOD': { state: 'NSW', postcode: '2134' },
  'ASHFIELD': { state: 'NSW', postcode: '2131' },
  'CANTERBURY': { state: 'NSW', postcode: '2193' },
  'KOGARAH': { state: 'NSW', postcode: '2217' },
  'SUTHERLAND': { state: 'NSW', postcode: '2232' },
  'MIRANDA': { state: 'NSW', postcode: '2228' },
  'DEE WHY': { state: 'NSW', postcode: '2099' },
  'BROOKVALE': { state: 'NSW', postcode: '2100' },
  'MONA VALE': { state: 'NSW', postcode: '2103' },
  'AVALON': { state: 'NSW', postcode: '2107' },
  'PALM BEACH': { state: 'NSW', postcode: '2108' },
  // Regional Cities
  'NEWCASTLE': { state: 'NSW', postcode: '2300' },
  'WOLLONGONG': { state: 'NSW', postcode: '2500' },
  'CENTRAL COAST': { state: 'NSW', postcode: '2250' },
  'GOSFORD': { state: 'NSW', postcode: '2250' },
  'TAMWORTH': { state: 'NSW', postcode: '2340' },
  'DUBBO': { state: 'NSW', postcode: '2830' },
  'WAGGA WAGGA': { state: 'NSW', postcode: '2650' },
  'ALBURY': { state: 'NSW', postcode: '2640' },
  'BATHURST': { state: 'NSW', postcode: '2795' },
  'ORANGE': { state: 'NSW', postcode: '2800' },
  'COFFS HARBOUR': { state: 'NSW', postcode: '2450' },
  'PORT MACQUARIE': { state: 'NSW', postcode: '2444' },
  'LISMORE': { state: 'NSW', postcode: '2480' },
  'BYRON BAY': { state: 'NSW', postcode: '2481' },
  'TWEED HEADS': { state: 'NSW', postcode: '2485' },
  // Regional NSW
  'ARMIDALE': { state: 'NSW', postcode: '2350' },
  'INVERELL': { state: 'NSW', postcode: '2360' },
  'MOREE': { state: 'NSW', postcode: '2400' },
  'NARRABRI': { state: 'NSW', postcode: '2390' },
  'GUNNEDAH': { state: 'NSW', postcode: '2380' },
  'QUIRINDI': { state: 'NSW', postcode: '2343' },
  'MUSWELLBROOK': { state: 'NSW', postcode: '2333' },
  'SINGLETON': { state: 'NSW', postcode: '2330' },
  'MAITLAND': { state: 'NSW', postcode: '2320' },
  'CESSNOCK': { state: 'NSW', postcode: '2325' },
  'RAYMOND TERRACE': { state: 'NSW', postcode: '2324' },
  'NELSON BAY': { state: 'NSW', postcode: '2315' },
  'FORSTER': { state: 'NSW', postcode: '2428' },
  'TAREE': { state: 'NSW', postcode: '2430' },
  'KEMPSEY': { state: 'NSW', postcode: '2440' },
  'GRAFTON': { state: 'NSW', postcode: '2460' },
  'BALLINA': { state: 'NSW', postcode: '2478' },
  'LENNOX HEAD': { state: 'NSW', postcode: '2478' },
  'CASINO': { state: 'NSW', postcode: '2470' },
  'KYOGLE': { state: 'NSW', postcode: '2474' },
  'MURWILLUMBAH': { state: 'NSW', postcode: '2484' },
  'NOWRA': { state: 'NSW', postcode: '2541' },
  'ULLADULLA': { state: 'NSW', postcode: '2539' },
  'BATEMANS BAY': { state: 'NSW', postcode: '2536' },
  'MORUYA': { state: 'NSW', postcode: '2537' },
  'NAROOMA': { state: 'NSW', postcode: '2546' },
  'BEGA': { state: 'NSW', postcode: '2550' },
  'MERIMBULA': { state: 'NSW', postcode: '2548' },
  'EDEN': { state: 'NSW', postcode: '2551' },
  'COOMA': { state: 'NSW', postcode: '2630' },
  'JINDABYNE': { state: 'NSW', postcode: '2627' },
  'THREDBO': { state: 'NSW', postcode: '2625' },
  'TUMUT': { state: 'NSW', postcode: '2720' },
  'GUNDAGAI': { state: 'NSW', postcode: '2722' },
  'COOTAMUNDRA': { state: 'NSW', postcode: '2590' },
  'YOUNG': { state: 'NSW', postcode: '2594' },
  'COWRA': { state: 'NSW', postcode: '2794' },
  'FORBES': { state: 'NSW', postcode: '2871' },
  'PARKES': { state: 'NSW', postcode: '2870' },
  'CONDOBOLIN': { state: 'NSW', postcode: '2877' },
  'LAKE CARGELLIGO': { state: 'NSW', postcode: '2672' },
  'WEST WYALONG': { state: 'NSW', postcode: '2671' },
  'GRIFFITH': { state: 'NSW', postcode: '2680' },
  'LEETON': { state: 'NSW', postcode: '2705' },
  'NARRANDERA': { state: 'NSW', postcode: '2700' },
  'HAY': { state: 'NSW', postcode: '2711' },
  'DENILIQUIN': { state: 'NSW', postcode: '2710' },
  'ECHUCA': { state: 'NSW', postcode: '2714' },
  'BROKEN HILL': { state: 'NSW', postcode: '2880' },
  'BOURKE': { state: 'NSW', postcode: '2840' },
  'COBAR': { state: 'NSW', postcode: '2835' },
  'NYNGAN': { state: 'NSW', postcode: '2825' },
  'WARREN': { state: 'NSW', postcode: '2824' },
  'GILGANDRA': { state: 'NSW', postcode: '2827' },
  'COONAMBLE': { state: 'NSW', postcode: '2829' },
  'LIGHTNING RIDGE': { state: 'NSW', postcode: '2834' },
  'WALGETT': { state: 'NSW', postcode: '2832' },
  'MUDGEE': { state: 'NSW', postcode: '2850' },
  'LITHGOW': { state: 'NSW', postcode: '2790' },
  'KATOOMBA': { state: 'NSW', postcode: '2780' },
  'SPRINGWOOD': { state: 'NSW', postcode: '2777' },
  'WINDSOR': { state: 'NSW', postcode: '2756' },
  'RICHMOND': { state: 'NSW', postcode: '2753' },
  'KURRAJONG': { state: 'NSW', postcode: '2758' },
  'BOWRAL': { state: 'NSW', postcode: '2576' },
  'MOSS VALE': { state: 'NSW', postcode: '2577' },
  'MITTAGONG': { state: 'NSW', postcode: '2575' },
  'PICTON': { state: 'NSW', postcode: '2571' },
  'CAMDEN': { state: 'NSW', postcode: '2570' },
  'NARELLAN': { state: 'NSW', postcode: '2567' },
  'ORAN PARK': { state: 'NSW', postcode: '2570' },
  
  // ========== VIC SUBURBS ==========
  // Melbourne Metro
  'MELBOURNE': { state: 'VIC', postcode: '3000' },
  'FRANKSTON': { state: 'VIC', postcode: '3199' },
  'DANDENONG': { state: 'VIC', postcode: '3175' },
  'BOX HILL': { state: 'VIC', postcode: '3128' },
  'RINGWOOD': { state: 'VIC', postcode: '3134' },
  'DONCASTER': { state: 'VIC', postcode: '3108' },
  'BRUNSWICK': { state: 'VIC', postcode: '3056' },
  'FOOTSCRAY': { state: 'VIC', postcode: '3011' },
  'WERRIBEE': { state: 'VIC', postcode: '3030' },
  'SUNSHINE': { state: 'VIC', postcode: '3020' },
  'ST KILDA': { state: 'VIC', postcode: '3182' },
  'SOUTH YARRA': { state: 'VIC', postcode: '3141' },
  'COLLINGWOOD': { state: 'VIC', postcode: '3066' },
  'FITZROY': { state: 'VIC', postcode: '3065' },
  'CARLTON': { state: 'VIC', postcode: '3053' },
  'HAWTHORN': { state: 'VIC', postcode: '3122' },
  'MALVERN': { state: 'VIC', postcode: '3144' },
  'BRIGHTON': { state: 'VIC', postcode: '3186' },
  'MORNINGTON': { state: 'VIC', postcode: '3931' },
  'PRESTON': { state: 'VIC', postcode: '3072' },
  'COBURG': { state: 'VIC', postcode: '3058' },
  'NORTHCOTE': { state: 'VIC', postcode: '3070' },
  'ESSENDON': { state: 'VIC', postcode: '3040' },
  'MOONEE PONDS': { state: 'VIC', postcode: '3039' },
  'MARIBYRNONG': { state: 'VIC', postcode: '3032' },
  'WILLIAMSTOWN': { state: 'VIC', postcode: '3016' },
  'ALTONA': { state: 'VIC', postcode: '3018' },
  'POINT COOK': { state: 'VIC', postcode: '3030' },
  'HOPPERS CROSSING': { state: 'VIC', postcode: '3029' },
  'MELTON': { state: 'VIC', postcode: '3337' },
  'SUNBURY': { state: 'VIC', postcode: '3429' },
  'CRAIGIEBURN': { state: 'VIC', postcode: '3064' },
  'EPPING': { state: 'VIC', postcode: '3076' },
  'SOUTH MORANG': { state: 'VIC', postcode: '3752' },
  'ELTHAM': { state: 'VIC', postcode: '3095' },
  'GREENSBOROUGH': { state: 'VIC', postcode: '3088' },
  'HEIDELBERG': { state: 'VIC', postcode: '3084' },
  'KEW': { state: 'VIC', postcode: '3101' },
  'CAMBERWELL': { state: 'VIC', postcode: '3124' },
  'GLEN WAVERLEY': { state: 'VIC', postcode: '3150' },
  'CHADSTONE': { state: 'VIC', postcode: '3148' },
  'OAKLEIGH': { state: 'VIC', postcode: '3166' },
  'MOORABBIN': { state: 'VIC', postcode: '3189' },
  'CHELTENHAM': { state: 'VIC', postcode: '3192' },
  'MENTONE': { state: 'VIC', postcode: '3194' },
  'MORDIALLOC': { state: 'VIC', postcode: '3195' },
  'CHELSEA': { state: 'VIC', postcode: '3196' },
  'PAKENHAM': { state: 'VIC', postcode: '3810' },
  'BERWICK': { state: 'VIC', postcode: '3806' },
  'NARRE WARREN': { state: 'VIC', postcode: '3805' },
  'CRANBOURNE': { state: 'VIC', postcode: '3977' },
  // Regional VIC
  'GEELONG': { state: 'VIC', postcode: '3220' },
  'BALLARAT': { state: 'VIC', postcode: '3350' },
  'BENDIGO': { state: 'VIC', postcode: '3550' },
  'SHEPPARTON': { state: 'VIC', postcode: '3630' },
  'MILDURA': { state: 'VIC', postcode: '3500' },
  'WARRNAMBOOL': { state: 'VIC', postcode: '3280' },
  'TRARALGON': { state: 'VIC', postcode: '3844' },
  'WODONGA': { state: 'VIC', postcode: '3690' },
  'WANGARATTA': { state: 'VIC', postcode: '3677' },
  'HORSHAM': { state: 'VIC', postcode: '3400' },
  'SWAN HILL': { state: 'VIC', postcode: '3585' },
  'ECHUCA': { state: 'VIC', postcode: '3564' },
  'BENALLA': { state: 'VIC', postcode: '3672' },
  'SEYMOUR': { state: 'VIC', postcode: '3660' },
  'KILMORE': { state: 'VIC', postcode: '3764' },
  'WALLAN': { state: 'VIC', postcode: '3756' },
  'KYNETON': { state: 'VIC', postcode: '3444' },
  'CASTLEMAINE': { state: 'VIC', postcode: '3450' },
  'DAYLESFORD': { state: 'VIC', postcode: '3460' },
  'BACCHUS MARSH': { state: 'VIC', postcode: '3340' },
  'GISBORNE': { state: 'VIC', postcode: '3437' },
  'WOODEND': { state: 'VIC', postcode: '3442' },
  'ARARAT': { state: 'VIC', postcode: '3377' },
  'STAWELL': { state: 'VIC', postcode: '3380' },
  'HAMILTON': { state: 'VIC', postcode: '3300' },
  'PORTLAND': { state: 'VIC', postcode: '3305' },
  'COLAC': { state: 'VIC', postcode: '3250' },
  'APOLLO BAY': { state: 'VIC', postcode: '3233' },
  'LORNE': { state: 'VIC', postcode: '3232' },
  'TORQUAY': { state: 'VIC', postcode: '3228' },
  'OCEAN GROVE': { state: 'VIC', postcode: '3226' },
  'DRYSDALE': { state: 'VIC', postcode: '3222' },
  'QUEENSCLIFF': { state: 'VIC', postcode: '3225' },
  'SALE': { state: 'VIC', postcode: '3850' },
  'BAIRNSDALE': { state: 'VIC', postcode: '3875' },
  'LAKES ENTRANCE': { state: 'VIC', postcode: '3909' },
  'ORBOST': { state: 'VIC', postcode: '3888' },
  'MALLACOOTA': { state: 'VIC', postcode: '3892' },
  'MOE': { state: 'VIC', postcode: '3825' },
  'MORWELL': { state: 'VIC', postcode: '3840' },
  'CHURCHILL': { state: 'VIC', postcode: '3842' },
  'WARRAGUL': { state: 'VIC', postcode: '3820' },
  'DROUIN': { state: 'VIC', postcode: '3818' },
  'LEONGATHA': { state: 'VIC', postcode: '3953' },
  'KORUMBURRA': { state: 'VIC', postcode: '3950' },
  'WONTHAGGI': { state: 'VIC', postcode: '3995' },
  'INVERLOCH': { state: 'VIC', postcode: '3996' },
  'PHILLIP ISLAND': { state: 'VIC', postcode: '3922' },
  'COWES': { state: 'VIC', postcode: '3922' },
  'SORRENTO': { state: 'VIC', postcode: '3943' },
  'PORTSEA': { state: 'VIC', postcode: '3944' },
  'ROSEBUD': { state: 'VIC', postcode: '3939' },
  'RYE': { state: 'VIC', postcode: '3941' },
  'DROMANA': { state: 'VIC', postcode: '3936' },
  'HASTINGS': { state: 'VIC', postcode: '3915' },
  'MOUNT ELIZA': { state: 'VIC', postcode: '3930' },
  'MOUNT MARTHA': { state: 'VIC', postcode: '3934' },
  'BRIGHT': { state: 'VIC', postcode: '3741' },
  'MOUNT BEAUTY': { state: 'VIC', postcode: '3699' },
  'FALLS CREEK': { state: 'VIC', postcode: '3699' },
  'MOUNT HOTHAM': { state: 'VIC', postcode: '3741' },
  'MANSFIELD': { state: 'VIC', postcode: '3722' },
  'ALEXANDRA': { state: 'VIC', postcode: '3714' },
  'YARRA GLEN': { state: 'VIC', postcode: '3775' },
  'HEALESVILLE': { state: 'VIC', postcode: '3777' },
  'LILYDALE': { state: 'VIC', postcode: '3140' },
  'BELGRAVE': { state: 'VIC', postcode: '3160' },
  'OLINDA': { state: 'VIC', postcode: '3788' },
  'MOUNT DANDENONG': { state: 'VIC', postcode: '3767' },
  
  // ========== WA SUBURBS ==========
  // Perth Metro
  'PERTH': { state: 'WA', postcode: '6000' },
  'FREMANTLE': { state: 'WA', postcode: '6160' },
  'JOONDALUP': { state: 'WA', postcode: '6027' },
  'ROCKINGHAM': { state: 'WA', postcode: '6168' },
  'MANDURAH': { state: 'WA', postcode: '6210' },
  'ARMADALE': { state: 'WA', postcode: '6112' },
  'MIDLAND': { state: 'WA', postcode: '6056' },
  'SUBIACO': { state: 'WA', postcode: '6008' },
  'COTTESLOE': { state: 'WA', postcode: '6011' },
  'CLAREMONT': { state: 'WA', postcode: '6010' },
  'SCARBOROUGH': { state: 'WA', postcode: '6019' },
  'MORLEY': { state: 'WA', postcode: '6062' },
  'CANNINGTON': { state: 'WA', postcode: '6107' },
  'VICTORIA PARK': { state: 'WA', postcode: '6100' },
  'SOUTH PERTH': { state: 'WA', postcode: '6151' },
  'COMO': { state: 'WA', postcode: '6152' },
  'APPLECROSS': { state: 'WA', postcode: '6153' },
  'MELVILLE': { state: 'WA', postcode: '6156' },
  'CANNING VALE': { state: 'WA', postcode: '6155' },
  'WANNEROO': { state: 'WA', postcode: '6065' },
  'ELLENBROOK': { state: 'WA', postcode: '6069' },
  'BUTLER': { state: 'WA', postcode: '6036' },
  'CLARKSON': { state: 'WA', postcode: '6030' },
  'BALDIVIS': { state: 'WA', postcode: '6171' },
  'SECRET HARBOUR': { state: 'WA', postcode: '6173' },
  // Regional WA
  'BUNBURY': { state: 'WA', postcode: '6230' },
  'GERALDTON': { state: 'WA', postcode: '6530' },
  'KALGOORLIE': { state: 'WA', postcode: '6430' },
  'ALBANY': { state: 'WA', postcode: '6330' },
  'BUSSELTON': { state: 'WA', postcode: '6280' },
  'MARGARET RIVER': { state: 'WA', postcode: '6285' },
  'DUNSBOROUGH': { state: 'WA', postcode: '6281' },
  'ESPERANCE': { state: 'WA', postcode: '6450' },
  'BROOME': { state: 'WA', postcode: '6725' },
  'KARRATHA': { state: 'WA', postcode: '6714' },
  'PORT HEDLAND': { state: 'WA', postcode: '6721' },
  'NEWMAN': { state: 'WA', postcode: '6753' },
  'TOM PRICE': { state: 'WA', postcode: '6751' },
  'EXMOUTH': { state: 'WA', postcode: '6707' },
  'CARNARVON': { state: 'WA', postcode: '6701' },
  'KUNUNURRA': { state: 'WA', postcode: '6743' },
  'DERBY': { state: 'WA', postcode: '6728' },
  'COLLIE': { state: 'WA', postcode: '6225' },
  'HARVEY': { state: 'WA', postcode: '6220' },
  'PINJARRA': { state: 'WA', postcode: '6208' },
  'WAROONA': { state: 'WA', postcode: '6215' },
  'DONNYBROOK': { state: 'WA', postcode: '6239' },
  'BRIDGETOWN': { state: 'WA', postcode: '6255' },
  'MANJIMUP': { state: 'WA', postcode: '6258' },
  'PEMBERTON': { state: 'WA', postcode: '6260' },
  'DENMARK': { state: 'WA', postcode: '6333' },
  'MOUNT BARKER': { state: 'WA', postcode: '6324' },
  'KATANNING': { state: 'WA', postcode: '6317' },
  'NARROGIN': { state: 'WA', postcode: '6312' },
  'NORTHAM': { state: 'WA', postcode: '6401' },
  'TOODYAY': { state: 'WA', postcode: '6566' },
  'YORK': { state: 'WA', postcode: '6302' },
  'MERREDIN': { state: 'WA', postcode: '6415' },
  'MOORA': { state: 'WA', postcode: '6510' },
  'JURIEN BAY': { state: 'WA', postcode: '6516' },
  'KALBARRI': { state: 'WA', postcode: '6536' },
  'DONGARA': { state: 'WA', postcode: '6525' },
  
  // ========== SA SUBURBS ==========
  // Adelaide Metro
  'ADELAIDE': { state: 'SA', postcode: '5000' },
  'GLENELG': { state: 'SA', postcode: '5045' },
  'PORT ADELAIDE': { state: 'SA', postcode: '5015' },
  'NORWOOD': { state: 'SA', postcode: '5067' },
  'UNLEY': { state: 'SA', postcode: '5061' },
  'BURNSIDE': { state: 'SA', postcode: '5066' },
  'MODBURY': { state: 'SA', postcode: '5092' },
  'SALISBURY': { state: 'SA', postcode: '5108' },
  'ELIZABETH': { state: 'SA', postcode: '5112' },
  'PROSPECT': { state: 'SA', postcode: '5082' },
  'WALKERVILLE': { state: 'SA', postcode: '5081' },
  'NORTH ADELAIDE': { state: 'SA', postcode: '5006' },
  'HENLEY BEACH': { state: 'SA', postcode: '5022' },
  'SEMAPHORE': { state: 'SA', postcode: '5019' },
  'MARION': { state: 'SA', postcode: '5043' },
  'REYNELLA': { state: 'SA', postcode: '5161' },
  'MORPHETT VALE': { state: 'SA', postcode: '5162' },
  'NOARLUNGA': { state: 'SA', postcode: '5168' },
  'SEAFORD': { state: 'SA', postcode: '5169' },
  'ALDINGA': { state: 'SA', postcode: '5173' },
  'MCLAREN VALE': { state: 'SA', postcode: '5171' },
  'STIRLING': { state: 'SA', postcode: '5152' },
  'MOUNT LOFTY': { state: 'SA', postcode: '5152' },
  'HAHNDORF': { state: 'SA', postcode: '5245' },
  'GAWLER': { state: 'SA', postcode: '5118' },
  'BAROSSA': { state: 'SA', postcode: '5352' },
  'TANUNDA': { state: 'SA', postcode: '5352' },
  'NURIOOTPA': { state: 'SA', postcode: '5355' },
  'ANGASTON': { state: 'SA', postcode: '5353' },
  // Regional SA
  'MOUNT BARKER': { state: 'SA', postcode: '5251' },
  'MOUNT GAMBIER': { state: 'SA', postcode: '5290' },
  'WHYALLA': { state: 'SA', postcode: '5600' },
  'PORT LINCOLN': { state: 'SA', postcode: '5606' },
  'MURRAY BRIDGE': { state: 'SA', postcode: '5253' },
  'VICTOR HARBOR': { state: 'SA', postcode: '5211' },
  'PORT PIRIE': { state: 'SA', postcode: '5540' },
  'PORT AUGUSTA': { state: 'SA', postcode: '5700' },
  'COOBER PEDY': { state: 'SA', postcode: '5723' },
  'CEDUNA': { state: 'SA', postcode: '5690' },
  'ROXBY DOWNS': { state: 'SA', postcode: '5725' },
  'RENMARK': { state: 'SA', postcode: '5341' },
  'BERRI': { state: 'SA', postcode: '5343' },
  'LOXTON': { state: 'SA', postcode: '5333' },
  'WAIKERIE': { state: 'SA', postcode: '5330' },
  'MANNUM': { state: 'SA', postcode: '5238' },
  'STRATHALBYN': { state: 'SA', postcode: '5255' },
  'GOOLWA': { state: 'SA', postcode: '5214' },
  'MIDDLETON': { state: 'SA', postcode: '5213' },
  'MENINGIE': { state: 'SA', postcode: '5264' },
  'NARACOORTE': { state: 'SA', postcode: '5271' },
  'BORDERTOWN': { state: 'SA', postcode: '5268' },
  'KEITH': { state: 'SA', postcode: '5267' },
  'MILLICENT': { state: 'SA', postcode: '5280' },
  'PENOLA': { state: 'SA', postcode: '5277' },
  'CLARE': { state: 'SA', postcode: '5453' },
  'BURRA': { state: 'SA', postcode: '5417' },
  'KAPUNDA': { state: 'SA', postcode: '5373' },
  'KADINA': { state: 'SA', postcode: '5554' },
  'MOONTA': { state: 'SA', postcode: '5558' },
  'WALLAROO': { state: 'SA', postcode: '5556' },
  'MAITLAND': { state: 'SA', postcode: '5573' },
  'ARDROSSAN': { state: 'SA', postcode: '5571' },
  'PORT VINCENT': { state: 'SA', postcode: '5581' },
  'YORKETOWN': { state: 'SA', postcode: '5576' },
  'KINGSCOTE': { state: 'SA', postcode: '5223' },
  'PENNESHAW': { state: 'SA', postcode: '5222' },
  
  // ========== TAS SUBURBS ==========
  // Hobart Metro
  'HOBART': { state: 'TAS', postcode: '7000' },
  'GLENORCHY': { state: 'TAS', postcode: '7010' },
  'SANDY BAY': { state: 'TAS', postcode: '7005' },
  'KINGSTON': { state: 'TAS', postcode: '7050' },
  'NEW TOWN': { state: 'TAS', postcode: '7008' },
  'MOONAH': { state: 'TAS', postcode: '7009' },
  'CLAREMONT': { state: 'TAS', postcode: '7011' },
  'ROSETTA': { state: 'TAS', postcode: '7010' },
  'HOWRAH': { state: 'TAS', postcode: '7018' },
  'BELLERIVE': { state: 'TAS', postcode: '7018' },
  'SORELL': { state: 'TAS', postcode: '7172' },
  'BRIGHTON': { state: 'TAS', postcode: '7030' },
  'BRIDGEWATER': { state: 'TAS', postcode: '7030' },
  // Regional TAS
  'LAUNCESTON': { state: 'TAS', postcode: '7250' },
  'DEVONPORT': { state: 'TAS', postcode: '7310' },
  'BURNIE': { state: 'TAS', postcode: '7320' },
  'ULVERSTONE': { state: 'TAS', postcode: '7315' },
  'WYNYARD': { state: 'TAS', postcode: '7325' },
  'SMITHTON': { state: 'TAS', postcode: '7330' },
  'DELORAINE': { state: 'TAS', postcode: '7304' },
  'WESTBURY': { state: 'TAS', postcode: '7303' },
  'LONGFORD': { state: 'TAS', postcode: '7301' },
  'CAMPBELL TOWN': { state: 'TAS', postcode: '7210' },
  'ROSS': { state: 'TAS', postcode: '7209' },
  'OATLANDS': { state: 'TAS', postcode: '7120' },
  'BOTHWELL': { state: 'TAS', postcode: '7030' },
  'NEW NORFOLK': { state: 'TAS', postcode: '7140' },
  'HUONVILLE': { state: 'TAS', postcode: '7109' },
  'CYGNET': { state: 'TAS', postcode: '7112' },
  'DOVER': { state: 'TAS', postcode: '7117' },
  'GEEVESTON': { state: 'TAS', postcode: '7116' },
  'TRIABUNNA': { state: 'TAS', postcode: '7190' },
  'BICHENO': { state: 'TAS', postcode: '7215' },
  'ST HELENS': { state: 'TAS', postcode: '7216' },
  'SCOTTSDALE': { state: 'TAS', postcode: '7260' },
  'BRIDPORT': { state: 'TAS', postcode: '7262' },
  'GEORGE TOWN': { state: 'TAS', postcode: '7253' },
  'BEAUTY POINT': { state: 'TAS', postcode: '7270' },
  'EXETER': { state: 'TAS', postcode: '7275' },
  'SHEFFIELD': { state: 'TAS', postcode: '7306' },
  'PENGUIN': { state: 'TAS', postcode: '7316' },
  'QUEENSTOWN': { state: 'TAS', postcode: '7467' },
  'STRAHAN': { state: 'TAS', postcode: '7468' },
  'ZEEHAN': { state: 'TAS', postcode: '7469' },
  
  // ========== NT SUBURBS ==========
  // Darwin Metro
  'DARWIN': { state: 'NT', postcode: '0800' },
  'PALMERSTON': { state: 'NT', postcode: '0830' },
  'CASUARINA': { state: 'NT', postcode: '0810' },
  'NIGHTCLIFF': { state: 'NT', postcode: '0810' },
  'FANNIE BAY': { state: 'NT', postcode: '0820' },
  'STUART PARK': { state: 'NT', postcode: '0820' },
  'PARAP': { state: 'NT', postcode: '0820' },
  'WINNELLIE': { state: 'NT', postcode: '0820' },
  'BERRIMAH': { state: 'NT', postcode: '0828' },
  'HOWARD SPRINGS': { state: 'NT', postcode: '0835' },
  'HUMPTY DOO': { state: 'NT', postcode: '0836' },
  // Regional NT
  'ALICE SPRINGS': { state: 'NT', postcode: '0870' },
  'KATHERINE': { state: 'NT', postcode: '0850' },
  'TENNANT CREEK': { state: 'NT', postcode: '0860' },
  'NHULUNBUY': { state: 'NT', postcode: '0880' },
  'JABIRU': { state: 'NT', postcode: '0886' },
  'YULARA': { state: 'NT', postcode: '0872' },
  
  // ========== ACT SUBURBS ==========
  'CANBERRA': { state: 'ACT', postcode: '2600' },
  'BELCONNEN': { state: 'ACT', postcode: '2617' },
  'WODEN': { state: 'ACT', postcode: '2606' },
  'TUGGERANONG': { state: 'ACT', postcode: '2900' },
  'GUNGAHLIN': { state: 'ACT', postcode: '2912' },
  'CIVIC': { state: 'ACT', postcode: '2601' },
  'BRADDON': { state: 'ACT', postcode: '2612' },
  'KINGSTON': { state: 'ACT', postcode: '2604' },
  'MANUKA': { state: 'ACT', postcode: '2603' },
  'DICKSON': { state: 'ACT', postcode: '2602' },
  'FYSHWICK': { state: 'ACT', postcode: '2609' },
  'MITCHELL': { state: 'ACT', postcode: '2911' },
  'PHILLIP': { state: 'ACT', postcode: '2606' },
  'WESTON': { state: 'ACT', postcode: '2611' },
  'CURTIN': { state: 'ACT', postcode: '2605' },
  'YARRALUMLA': { state: 'ACT', postcode: '2600' },
  'DEAKIN': { state: 'ACT', postcode: '2600' },
  'BARTON': { state: 'ACT', postcode: '2600' },
  'FORREST': { state: 'ACT', postcode: '2603' },
  'GRIFFITH': { state: 'ACT', postcode: '2603' },
  'NARRABUNDAH': { state: 'ACT', postcode: '2604' },
  'RED HILL': { state: 'ACT', postcode: '2603' },
  'AINSLIE': { state: 'ACT', postcode: '2602' },
  "O'CONNOR": { state: 'ACT', postcode: '2602' },
  'LYNEHAM': { state: 'ACT', postcode: '2602' },
  'TURNER': { state: 'ACT', postcode: '2612' },
  'BRUCE': { state: 'ACT', postcode: '2617' },
  'COOK': { state: 'ACT', postcode: '2614' },
  'MACQUARIE': { state: 'ACT', postcode: '2614' },
  'ARANDA': { state: 'ACT', postcode: '2614' },
  'HAWKER': { state: 'ACT', postcode: '2614' },
  'PAGE': { state: 'ACT', postcode: '2614' },
  'SCULLIN': { state: 'ACT', postcode: '2614' },
  'FLOREY': { state: 'ACT', postcode: '2615' },
  'LATHAM': { state: 'ACT', postcode: '2615' },
  'HIGGINS': { state: 'ACT', postcode: '2615' },
  'HOLT': { state: 'ACT', postcode: '2615' },
  'KIPPAX': { state: 'ACT', postcode: '2615' },
  'CHARNWOOD': { state: 'ACT', postcode: '2615' },
  'FLYNN': { state: 'ACT', postcode: '2615' },
  'FRASER': { state: 'ACT', postcode: '2615' },
  'SPENCE': { state: 'ACT', postcode: '2615' },
  'EVATT': { state: 'ACT', postcode: '2617' },
  'MCKELLAR': { state: 'ACT', postcode: '2617' },
  'KALEEN': { state: 'ACT', postcode: '2617' },
  'GIRALANG': { state: 'ACT', postcode: '2617' },
  'CASEY': { state: 'ACT', postcode: '2913' },
  'NGUNNAWAL': { state: 'ACT', postcode: '2913' },
  'AMAROO': { state: 'ACT', postcode: '2914' },
  'HARRISON': { state: 'ACT', postcode: '2914' },
  'FRANKLIN': { state: 'ACT', postcode: '2913' },
  'FORDE': { state: 'ACT', postcode: '2914' },
  'BONNER': { state: 'ACT', postcode: '2914' },
  'CRACE': { state: 'ACT', postcode: '2911' },
  'PALMERSTON': { state: 'ACT', postcode: '2913' },
  'MONCRIEFF': { state: 'ACT', postcode: '2914' },
  'JACKA': { state: 'ACT', postcode: '2914' },
  'TAYLOR': { state: 'ACT', postcode: '2913' },
  'THROSBY': { state: 'ACT', postcode: '2914' },
  'KAMBAH': { state: 'ACT', postcode: '2902' },
  'WANNIASSA': { state: 'ACT', postcode: '2903' },
  'GREENWAY': { state: 'ACT', postcode: '2900' },
  'CALWELL': { state: 'ACT', postcode: '2905' },
  'GORDON': { state: 'ACT', postcode: '2906' },
  'CONDER': { state: 'ACT', postcode: '2906' },
  'BANKS': { state: 'ACT', postcode: '2906' },
  'BONYTHON': { state: 'ACT', postcode: '2905' },
  'ISABELLA PLAINS': { state: 'ACT', postcode: '2905' },
  'CHISHOLM': { state: 'ACT', postcode: '2905' },
  'GILMORE': { state: 'ACT', postcode: '2905' },
  'RICHARDSON': { state: 'ACT', postcode: '2905' },
  'THEODORE': { state: 'ACT', postcode: '2905' },
  'GOWRIE': { state: 'ACT', postcode: '2904' },
  'FADDEN': { state: 'ACT', postcode: '2904' },
  'MONASH': { state: 'ACT', postcode: '2904' },
  'OXLEY': { state: 'ACT', postcode: '2903' },
  'HOLDER': { state: 'ACT', postcode: '2611' },
  'RIVETT': { state: 'ACT', postcode: '2611' },
  'STIRLING': { state: 'ACT', postcode: '2611' },
  'WARAMANGA': { state: 'ACT', postcode: '2611' },
  'FISHER': { state: 'ACT', postcode: '2611' },
  'CHAPMAN': { state: 'ACT', postcode: '2611' },
  'DUFFY': { state: 'ACT', postcode: '2611' },
  'TORRENS': { state: 'ACT', postcode: '2607' },
  'FARRER': { state: 'ACT', postcode: '2607' },
  'PEARCE': { state: 'ACT', postcode: '2607' },
  'GARRAN': { state: 'ACT', postcode: '2605' },
  'HUGHES': { state: 'ACT', postcode: '2605' },
  'LYONS': { state: 'ACT', postcode: '2606' },
  'CHIFLEY': { state: 'ACT', postcode: '2606' },
  'MAWSON': { state: 'ACT', postcode: '2607' },
  'ISAACS': { state: 'ACT', postcode: '2607' },
  "O'MALLEY": { state: 'ACT', postcode: '2606' },
};

// Async function to lookup suburb in schools_directory database
async function lookupSuburbInDatabase(
  supabase: ReturnType<typeof createClient>,
  suburb: string
): Promise<{ state: string; postcode: string } | null> {
  if (!suburb) return null;
  
  const normalizedSuburb = suburb.trim().toUpperCase();
  
  try {
    const { data, error } = await supabase
      .from('schools_directory')
      .select('state, postcode')
      .ilike('suburb', normalizedSuburb)
      .limit(1)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return { state: data.state, postcode: data.postcode };
  } catch {
    return null;
  }
}

// Lookup suburb from static mapping
function lookupSuburbStatic(suburb: string): { state: string; postcode: string } | null {
  if (!suburb) return null;
  const normalizedSuburb = suburb.trim().toUpperCase();
  return SUBURB_LOOKUP[normalizedSuburb] || null;
}

// Extract state from address or suburb text patterns
function extractStateFromText(address?: string, suburb?: string): string | null {
  const text = `${address || ''} ${suburb || ''}`.toUpperCase();
  const states = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
  
  for (const state of states) {
    // Check for state abbreviation with word boundaries
    const regex = new RegExp(`\\b${state}\\b`);
    if (regex.test(text)) {
      return state;
    }
  }
  
  // Check for full state names
  const stateNames: Record<string, string> = {
    'NEW SOUTH WALES': 'NSW',
    'VICTORIA': 'VIC',
    'QUEENSLAND': 'QLD',
    'WESTERN AUSTRALIA': 'WA',
    'SOUTH AUSTRALIA': 'SA',
    'TASMANIA': 'TAS',
    'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
    'NORTHERN TERRITORY': 'NT',
  };
  
  for (const [fullName, abbrev] of Object.entries(stateNames)) {
    if (text.includes(fullName)) {
      return abbrev;
    }
  }
  
  return null;
}

// Extract postcode from address text (4 digit number for Australian postcodes)
function extractPostcodeFromText(address?: string): string | null {
  if (!address) return null;
  
  // Australian postcodes are 4 digits, typically at the end of address
  const postcodeMatch = address.match(/\b(\d{4})\b/);
  if (postcodeMatch) {
    const postcode = postcodeMatch[1];
    // Basic validation: Australian postcodes start with 0-7
    if (['0', '1', '2', '3', '4', '5', '6', '7'].includes(postcode[0])) {
      return postcode;
    }
  }
  return null;
}

// Determine state from postcode range
function getStateFromPostcode(postcode: string): string | null {
  if (!postcode || postcode.length !== 4) return null;
  
  const firstDigit = parseInt(postcode[0], 10);
  const postcodeNum = parseInt(postcode, 10);
  
  // NSW: 1000-2599, 2619-2899, 2921-2999
  if (firstDigit === 1 || firstDigit === 2) {
    if (postcodeNum >= 2600 && postcodeNum <= 2618) return 'ACT';
    if (postcodeNum === 2620 || postcodeNum === 2900) return 'ACT'; // Jerrabomberra/Tuggeranong
    return 'NSW';
  }
  
  // VIC: 3000-3999, 8000-8999
  if (firstDigit === 3 || firstDigit === 8) return 'VIC';
  
  // QLD: 4000-4999, 9000-9999
  if (firstDigit === 4 || firstDigit === 9) return 'QLD';
  
  // SA: 5000-5799
  if (firstDigit === 5) return 'SA';
  
  // WA: 6000-6797
  if (firstDigit === 6) return 'WA';
  
  // TAS: 7000-7799
  if (firstDigit === 7) return 'TAS';
  
  // NT: 0800-0899
  if (firstDigit === 0) return 'NT';
  
  return null;
}

// Main function to auto-detect state and postcode
async function autoDetectLocation(
  supabase: ReturnType<typeof createClient>,
  listing: ListingData
): Promise<{ state: string | null; postcode: string | null }> {
  let detectedState = listing.state || null;
  // Check if listing has explicit postcode/zipcode
  let detectedPostcode: string | null = listing.postcode || listing.zipcode || null;
  
  // Priority 1: Use explicit state if provided and valid
  if (detectedState && ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].includes(detectedState.toUpperCase())) {
    detectedState = detectedState.toUpperCase();
    console.log(`[Auto-Detect] Using explicit state from listing: ${detectedState}`);
  } else {
    detectedState = null;
  }
  
  // Priority 2: If we have explicit postcode, derive state from it
  if (!detectedState && detectedPostcode) {
    detectedState = getStateFromPostcode(detectedPostcode);
    if (detectedState) {
      console.log(`[Auto-Detect] Derived state from explicit postcode ${detectedPostcode}: ${detectedState}`);
    }
  }
  
  // Priority 3: Extract from address text
  if (!detectedState) {
    detectedState = extractStateFromText(listing.address, listing.suburb);
    if (detectedState) {
      console.log(`[Auto-Detect] Found state in address/suburb text: ${detectedState}`);
    }
  }
  
  // Priority 4: Extract postcode from address and derive state
  if (!detectedState) {
    const addressPostcode = extractPostcodeFromText(listing.address);
    if (addressPostcode) {
      detectedPostcode = detectedPostcode || addressPostcode;
      detectedState = getStateFromPostcode(addressPostcode);
      console.log(`[Auto-Detect] Derived state from address postcode ${addressPostcode}: ${detectedState}`);
    }
  }
  
  // Priority 4: Lookup suburb in database (schools_directory)
  if (!detectedState && listing.suburb) {
    const dbLookup = await lookupSuburbInDatabase(supabase, listing.suburb);
    if (dbLookup) {
      detectedState = dbLookup.state;
      detectedPostcode = detectedPostcode || dbLookup.postcode;
      console.log(`[Auto-Detect] Found suburb "${listing.suburb}" in database: state=${detectedState}, postcode=${detectedPostcode}`);
    }
  }
  
  // Priority 5: Static suburb lookup
  if (!detectedState && listing.suburb) {
    const staticLookup = lookupSuburbStatic(listing.suburb);
    if (staticLookup) {
      detectedState = staticLookup.state;
      detectedPostcode = detectedPostcode || staticLookup.postcode;
      console.log(`[Auto-Detect] Found suburb "${listing.suburb}" in static lookup: state=${detectedState}, postcode=${detectedPostcode}`);
    }
  }
  
  // Try to get postcode from suburb if we have state but no postcode
  if (detectedState && !detectedPostcode && listing.suburb) {
    const staticLookup = lookupSuburbStatic(listing.suburb);
    if (staticLookup && staticLookup.state === detectedState) {
      detectedPostcode = staticLookup.postcode;
    } else {
      const dbLookup = await lookupSuburbInDatabase(supabase, listing.suburb);
      if (dbLookup && dbLookup.state === detectedState) {
        detectedPostcode = dbLookup.postcode;
      }
    }
  }
  
  if (!detectedState) {
    console.log(`[Auto-Detect] Could not determine state for suburb: ${listing.suburb}`);
  }
  
  return { state: detectedState, postcode: detectedPostcode };
}

// Evaluate if a listing matches a switch's criteria
function evaluateCriteria(listing: ListingData, criteria: SwitchCriteria): boolean {
  // Property Types
  if (criteria.propertyTypes?.length) {
    if (!listing.propertyType || !criteria.propertyTypes.includes(listing.propertyType)) {
      return false;
    }
  }
  
  // Price Range
  if (criteria.priceMin !== null && criteria.priceMin !== undefined) {
    if (!listing.price || listing.price < criteria.priceMin) {
      return false;
    }
  }
  if (criteria.priceMax !== null && criteria.priceMax !== undefined) {
    if (!listing.price || listing.price > criteria.priceMax) {
      return false;
    }
  }
  
  // Bedrooms
  if (criteria.bedsMin !== null && criteria.bedsMin !== undefined) {
    if (listing.beds === undefined || listing.beds === null || listing.beds < criteria.bedsMin) {
      return false;
    }
  }
  if (criteria.bedsMax !== null && criteria.bedsMax !== undefined) {
    if (listing.beds === undefined || listing.beds === null || listing.beds > criteria.bedsMax) {
      return false;
    }
  }
  
  // Bathrooms
  if (criteria.bathsMin !== null && criteria.bathsMin !== undefined) {
    if (listing.baths === undefined || listing.baths === null || listing.baths < criteria.bathsMin) {
      return false;
    }
  }
  if (criteria.bathsMax !== null && criteria.bathsMax !== undefined) {
    if (listing.baths === undefined || listing.baths === null || listing.baths > criteria.bathsMax) {
      return false;
    }
  }
  
  // States - use extractStateFromText for synchronous check in criteria evaluation
  if (criteria.states?.length) {
    const listingState = listing.state?.toUpperCase() || extractStateFromText(listing.address, listing.suburb);
    if (!listingState || !criteria.states.includes(listingState)) {
      return false;
    }
  }
  
  // Categories
  if (criteria.categories?.length) {
    if (!listing.category || !criteria.categories.includes(listing.category)) {
      return false;
    }
  }
  
  // Confidence Score
  if (criteria.confidenceMin !== null && criteria.confidenceMin !== undefined) {
    if (listing.confidence === undefined || listing.confidence === null || listing.confidence < criteria.confidenceMin) {
      return false;
    }
  }
  
  // Has Price
  if (criteria.hasPrice === true) {
    if (!listing.price) {
      return false;
    }
  } else if (criteria.hasPrice === false) {
    // No price required - always passes
  }
  
  // Source Hosts
  if (criteria.sourceHosts?.length) {
    if (!listing.sourceHost) {
      return false;
    }
    const normalizedHost = listing.sourceHost.toLowerCase();
    const matchesHost = criteria.sourceHosts.some(host => 
      normalizedHost.includes(host.toLowerCase())
    );
    if (!matchesHost) {
      return false;
    }
  }
  
  return true;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // AUTH (Critical 1): this webhook creates investment-report records and
    // invokes the PAID report generator with the service role. It must fail
    // closed to anonymous callers. Accept EITHER an internal service call
    // (service-role key / HMAC-signed) OR a dedicated high-entropy webhook
    // secret presented in x-webhook-secret (constant-time compared). When
    // AUTO_REPORT_WEBHOOK_SECRET is unset the secret path is unavailable and
    // the endpoint refuses to start — it does not silently run open.
    const rawBody = await req.text();
    const expectedSecret = (Deno.env.get('AUTO_REPORT_WEBHOOK_SECRET') || '').trim();
    const providedSecret = (req.headers.get('x-webhook-secret') || '').trim();
    const secretOk = expectedSecret.length >= 16 && timingSafeEqual(providedSecret, expectedSecret);
    const internal = await verifyInternal(supabase, req, rawBody);
    if (!internal.ok && !secretOk) {
      await logSecurityEvent(supabase, {
        action: 'auto_report_webhook.invoke',
        decision: 'deny',
        reason_code: expectedSecret.length < 16 ? 'webhook_secret_unconfigured' : (internal.errorCode ?? 'invalid_secret'),
        actor_type: 'webhook',
      });
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = JSON.parse(rawBody);

    // Support both single listing and batch
    const listings: ListingData[] = Array.isArray(body.listings) ? body.listings : [body.listing || body];
    
    if (!listings.length || !listings[0].id) {
      return new Response(
        JSON.stringify({ error: 'No valid listing data provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Auto-Report Webhook] Processing ${listings.length} listing(s)`);

    // Check master switch
    const { data: masterSettings, error: masterError } = await supabase
      .from('auto_report_master_settings')
      .select('is_enabled')
      .single();
    
    if (masterError || !masterSettings?.is_enabled) {
      console.log('[Auto-Report Webhook] Master switch is OFF - skipping');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Master switch is disabled',
          processed: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get enabled switches (OR logic - any match triggers report)
    const { data: switches, error: switchError } = await supabase
      .from('auto_report_switches')
      .select('*')
      .eq('is_enabled', true);
    

    console.log(`[Auto-Report Webhook] Found ${switches.length} enabled switch(es)`);

    const results: Array<{ listingId: string; matched: boolean; switchName?: string; reportId?: string; error?: string }> = [];

    // Process each listing
    for (const listing of listings) {
      // Debug: Log all received fields
      console.log(`[Auto-Report Webhook] Received listing data:`, JSON.stringify(listing, null, 2));
      
      // Auto-detect state and postcode if missing
      const { state: detectedState, postcode: detectedPostcode } = await autoDetectLocation(supabase, listing);
      
      // Update listing with detected values for criteria evaluation and report generation
      const enrichedListing = {
        ...listing,
        state: listing.state || detectedState,
        detectedPostcode: detectedPostcode,
      };
      
      console.log(`[Auto-Report Webhook] Location detection: state=${enrichedListing.state}, postcode=${detectedPostcode}`);
      
      // Construct the best possible address from available data (OR logic: address OR propertyName)
      let listingAddress = '';
      const propertyName = listing.propertyName || listing.property_name;
      
      if (listing.address && listing.address.trim()) {
        // Priority 1: Use street address if available
        listingAddress = listing.address.trim();
        console.log(`[Auto-Report Webhook] Using street address: ${listingAddress}`);
      } else if (propertyName && propertyName.trim()) {
        // Priority 2: Use property name if no street address
        listingAddress = propertyName.trim();
        console.log(`[Auto-Report Webhook] No street address, using property name: ${listingAddress}`);
      } else if (listing.suburb && enrichedListing.state) {
        // Priority 3: Fall back to suburb + state (use detected state)
        listingAddress = `${listing.suburb}, ${enrichedListing.state}`;
        console.log(`[Auto-Report Webhook] No address/propertyName, using suburb/state: ${listingAddress}`);
      } else if (listing.suburb) {
        // Priority 4: Just suburb
        listingAddress = listing.suburb;
        console.log(`[Auto-Report Webhook] No address/propertyName, using suburb only: ${listingAddress}`);
      } else {
        // Last resort
        listingAddress = `Unknown Property (${listing.id})`;
        console.log(`[Auto-Report Webhook] No address data available, using fallback: ${listingAddress}`);
      }
      
      console.log(`[Auto-Report Webhook] Evaluating listing: ${listingAddress}`);

      let matchedSwitch: AutoReportSwitch | null = null;

      // Evaluate against switches (OR logic - first match triggers) using enriched listing with detected state
      for (const switchItem of switches) {
        const criteria = switchItem.criteria as SwitchCriteria;
        if (evaluateCriteria(enrichedListing, criteria)) {
          matchedSwitch = switchItem;
          console.log(`[Auto-Report Webhook] Matched switch: ${switchItem.name}`);
          break; // One report per listing - first match triggers
        }
      }

      if (!matchedSwitch) {
        console.log(`[Auto-Report Webhook] No switch matched for listing ${listing.id}`);
        results.push({ listingId: listing.id, matched: false });
        continue;
      }

      // Create log entry
      const { data: logEntry, error: logError } = await supabase
        .from('auto_report_generation_log')
        .insert({
          listing_id: listing.id,
          listing_address: listingAddress,
          switch_id: matchedSwitch.id,
          switch_name: matchedSwitch.name,
          status: 'processing'
        })
        .select()
        .single();

      if (logError) {
        console.error(`[Auto-Report Webhook] Failed to create log entry: ${logError.message}`);
      }

      // Trigger report generation
      try {
        console.log(`[Auto-Report Webhook] Triggering report generation for ${listingAddress}`);
        
        // First, create a pending report in the database so we have a reportId
        const { data: newReport, error: createError } = await supabase
          .from('investment_reports')
          .insert({
            property_address: listingAddress,
            property_listing_id: listing.id,
            report_content: '',
            status: 'pending',
            report_scope: 'address'
          })
          .select('id')
          .single();
        
        if (createError || !newReport) {
          throw new Error(`Failed to create report record: ${createError?.message || 'Unknown error'}`);
        }
        
        const createdReportId = newReport.id;
        console.log(`[Auto-Report Webhook] Created pending report with ID: ${createdReportId}`);
        
        // Parse price and rent from listing data
        // Airtable 'price' field is typically the purchase price
        // Look for weekly rent in dedicated rent fields
        const purchasePrice = listing.price ? parseFloat(String(listing.price).replace(/[^0-9.]/g, '')) : null;
        const weeklyRent = listing.weeklyRent || listing.weekly_rent || listing.rent || null;
        const parsedWeeklyRent = weeklyRent ? parseFloat(String(weeklyRent).replace(/[^0-9.]/g, '')) : null;
        
        console.log(`[Auto-Report Webhook] Parsed pricing: purchasePrice=${purchasePrice}, weeklyRent=${parsedWeeklyRent}`);
        
        // Prepare report generation payload with the reportId and detected location data
        const reportPayload = {
          reportId: createdReportId, // Include reportId so generate-investment-report updates this record
          propertyAddress: listingAddress,
          propertyDetails: {
            queryType: 'address',
            suburb: listing.suburb || null,
            state: enrichedListing.state || null,
            postcode: detectedPostcode || null,
            // Include price in propertyDetails - this is what generate-investment-report checks
            price: purchasePrice,
            weeklyRent: parsedWeeklyRent,
            propertyType: listing.propertyType || null,
            beds: listing.beds || listing.bedrooms || null,
            baths: listing.baths || listing.bathrooms || null,
          },
          propertyListingId: listing.id,
          // Include detected location for better report generation
          suburb: listing.suburb || null,
          state: enrichedListing.state || null,
          postcode: detectedPostcode || null,
        };
        
        console.log(`[Auto-Report Webhook] Report payload includes: suburb=${listing.suburb}, state=${enrichedListing.state}, postcode=${detectedPostcode}`);

        // Call generate-investment-report function (fire-and-forget pattern for long operations)
        // Don't await the full response to avoid timeout - the function will update the DB directly
        const reportResponse = await fetch(`${supabaseUrl}/functions/v1/generate-investment-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
          },
          body: JSON.stringify(reportPayload),
        });

        if (!reportResponse.ok) {
          const errorText = await reportResponse.text();
          throw new Error(`Report generation failed: ${errorText}`);
        }

        const reportResult = await reportResponse.json();
        console.log(`[Auto-Report Webhook] Report generation response received, success: ${reportResult.success}`);
        
        // Update log entry with success
        if (logEntry) {
          await supabase
            .from('auto_report_generation_log')
            .update({
              status: 'completed',
              report_id: createdReportId,
              completed_at: new Date().toISOString()
            })
            .eq('id', logEntry.id);
        }

        // Also mark as processed
        await supabase
          .from('auto_report_processed_listings')
          .upsert({
            listing_id: listing.id,
            listing_address: listingAddress,
            report_id: createdReportId,
            switch_id: matchedSwitch.id,
            skipped: false,
            processed_at: new Date().toISOString()
          }, { onConflict: 'listing_id' });

        results.push({
          listingId: listing.id,
          matched: true,
          switchName: matchedSwitch.name,
          reportId: createdReportId
        });

        console.log(`[Auto-Report Webhook] Report generated successfully: ${createdReportId}`);
      } catch (genError) {
        const errorMessage = genError instanceof Error ? genError.message : 'Unknown error';
        console.error(`[Auto-Report Webhook] Report generation error: ${errorMessage}`);
        
        // Update log entry with failure
        if (logEntry) {
          await supabase
            .from('auto_report_generation_log')
            .update({
              status: 'failed',
              error_message: errorMessage,
              completed_at: new Date().toISOString()
            })
            .eq('id', logEntry.id);
        }

        results.push({
          listingId: listing.id,
          matched: true,
          switchName: matchedSwitch.name,
          error: errorMessage
        });
      }
    }

    const successCount = results.filter(r => r.reportId).length;
    const failedCount = results.filter(r => r.error).length;
    const skippedCount = results.filter(r => !r.matched).length;

    return new Response(
      JSON.stringify({
        success: true,
        processed: listings.length,
        generated: successCount,
        failed: failedCount,
        skipped: skippedCount,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Auto-Report Webhook] Error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'auto-report-webhook')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
