export type IndustrialBenchmarkStatus =
  | 'Awaiting Inputs'
  | 'Preliminary Benchmark'
  | 'Balanced'
  | 'Under-Improved'
  | 'Over-Improved'
  | 'Hardstand Heavy'
  | 'Office Heavy'
  | 'Pricing Review Required'
  | 'Verified';

export type BenchmarkConfidence = 'Pending' | 'Low' | 'Medium' | 'High';

export const industrialBenchmarkConfig = {
  siteCoverPct: {
    lowMax: 35,
    balancedMax: 60,
    lowExplanation: 'Low site cover may indicate under-improvement or high hardstand utility.',
    balancedExplanation: 'Balanced site cover indicates a typical industrial use balance between improvements and yard.',
    highExplanation: 'High site cover indicates a heavily improved site with less hardstand flexibility.',
  },
  hardstandRatioPct: {
    lowMax: 15,
    balancedMax: 45,
    lowExplanation: 'Low hardstand may limit external storage, truck circulation or loading flexibility.',
    balancedExplanation: 'Balanced hardstand indicates a functional industrial yard component.',
    highExplanation: 'High hardstand indicates a hardstand-heavy asset that may suit transport, logistics or storage uses.',
  },
  officeRatioPct: {
    lowMax: 5,
    balancedMax: 20,
    lowExplanation: 'Low office ratio indicates a warehouse-dominant industrial asset.',
    balancedExplanation: 'Balanced office ratio indicates a typical industrial office component.',
    highExplanation: 'High office ratio may affect warehouse usability and industrial comparability.',
  },
  rentPerSqmGla: { min: 80, max: 350 },
  pricePerSqmGla: { min: 1000, max: 4500 },
  pricePerSqmSite: { min: 250, max: 2000 },
} as const;

interface AssessmentInputs {
  siteCoverPct: number | null;
  hardstandRatioPct: number | null;
  officeRatioPct: number | null;
  pricePerSqmGla: number | null;
  pricePerSqmSite: number | null;
  verified: boolean;
}

export function assessIndustrialBenchmark(inputs: AssessmentInputs, config = industrialBenchmarkConfig) {
  if ([inputs.siteCoverPct, inputs.hardstandRatioPct, inputs.officeRatioPct, inputs.pricePerSqmGla, inputs.pricePerSqmSite].some((value) => value === null)) {
    return {
      status: 'Awaiting Inputs' as IndustrialBenchmarkStatus,
      coverageBand: 'Awaiting Inputs',
      explanation: 'Import or enter the required physical and pricing inputs to interpret industrial benchmarks.',
      confidence: 'Pending' as BenchmarkConfidence,
      verificationStatus: 'Not verified',
      notes: ['Benchmark interpretation is pending because one or more required inputs are missing.'],
    };
  }

  const notes: string[] = [];
  let status: IndustrialBenchmarkStatus = inputs.verified ? 'Verified' : 'Preliminary Benchmark';
  let coverageBand = 'Balanced';
  let explanation: string = config.siteCoverPct.balancedExplanation;

  if ((inputs.siteCoverPct ?? 0) < config.siteCoverPct.lowMax) {
    status = 'Under-Improved';
    coverageBand = 'Low site cover';
    explanation = config.siteCoverPct.lowExplanation;
  } else if ((inputs.siteCoverPct ?? 0) > config.siteCoverPct.balancedMax) {
    status = 'Over-Improved';
    coverageBand = 'High site cover';
    explanation = config.siteCoverPct.highExplanation;
  } else if (!inputs.verified) {
    status = 'Balanced';
  }

  if ((inputs.hardstandRatioPct ?? 0) > config.hardstandRatioPct.balancedMax) {
    status = 'Hardstand Heavy';
    notes.push(config.hardstandRatioPct.highExplanation);
  } else if ((inputs.hardstandRatioPct ?? 0) < config.hardstandRatioPct.lowMax) {
    notes.push(config.hardstandRatioPct.lowExplanation);
  } else {
    notes.push(config.hardstandRatioPct.balancedExplanation);
  }

  if ((inputs.officeRatioPct ?? 0) > config.officeRatioPct.balancedMax) {
    status = 'Office Heavy';
    notes.push(config.officeRatioPct.highExplanation);
  } else if ((inputs.officeRatioPct ?? 0) < config.officeRatioPct.lowMax) {
    notes.push(config.officeRatioPct.lowExplanation);
  } else {
    notes.push(config.officeRatioPct.balancedExplanation);
  }

  const pricingOutsideRange =
    (inputs.pricePerSqmGla ?? 0) < config.pricePerSqmGla.min ||
    (inputs.pricePerSqmGla ?? 0) > config.pricePerSqmGla.max ||
    (inputs.pricePerSqmSite ?? 0) < config.pricePerSqmSite.min ||
    (inputs.pricePerSqmSite ?? 0) > config.pricePerSqmSite.max;

  if (pricingOutsideRange) {
    status = 'Pricing Review Required';
    notes.push(`Pricing is outside configured benchmark ranges ($/m² GLA ${config.pricePerSqmGla.min.toLocaleString('en-AU')}–${config.pricePerSqmGla.max.toLocaleString('en-AU')}, $/m² site ${config.pricePerSqmSite.min.toLocaleString('en-AU')}–${config.pricePerSqmSite.max.toLocaleString('en-AU')}).`);
  }

  if (inputs.verified && status === 'Balanced') status = 'Verified';

  return {
    status,
    coverageBand,
    explanation,
    confidence: inputs.verified ? 'High' as BenchmarkConfidence : 'Medium' as BenchmarkConfidence,
    verificationStatus: inputs.verified ? 'Verified' : 'Preliminary — verify before relying',
    notes: [explanation, ...notes],
  };
}
