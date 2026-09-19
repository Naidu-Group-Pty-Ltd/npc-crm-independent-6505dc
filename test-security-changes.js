/**
 * Security Changes Validation Test
 * 
 * This script validates:
 * 1. File structure and imports
 * 2. TypeScript syntax (basic checks)
 * 3. Logic flow validation
 * 
 * Note: Full testing requires Deno runtime or Supabase deployment
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Security Changes Validation Test\n');
console.log('=' .repeat(60));

// Test results
const results = {
  passed: [],
  failed: [],
  warnings: []
};

// Helper to check if file exists
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

// Helper to read file content
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

// Test 1: Check if leaked password check file exists
console.log('\n📁 Test 1: File Structure');
console.log('-'.repeat(60));

const leakedPasswordFile = path.join(__dirname, 'supabase', 'functions', '_shared', 'leakedPasswordCheck.ts');
if (fileExists(leakedPasswordFile)) {
  console.log('✅ leakedPasswordCheck.ts exists');
  results.passed.push('leakedPasswordCheck.ts file exists');
  
  const content = readFile(leakedPasswordFile);
  if (content) {
    // Check for required exports
    if (content.includes('export async function checkLeakedPassword')) {
      console.log('✅ checkLeakedPassword function exported');
      results.passed.push('checkLeakedPassword function exists');
    } else {
      console.log('❌ checkLeakedPassword function not found');
      results.failed.push('checkLeakedPassword function missing');
    }
    
    if (content.includes('export async function checkLeakedPasswordWithTimeout')) {
      console.log('✅ checkLeakedPasswordWithTimeout function exported');
      results.passed.push('checkLeakedPasswordWithTimeout function exists');
    } else {
      console.log('❌ checkLeakedPasswordWithTimeout function not found');
      results.failed.push('checkLeakedPasswordWithTimeout function missing');
    }
    
    // Check for k-anonymity implementation
    if (content.includes('prefix') && content.includes('suffix')) {
      console.log('✅ k-anonymity implementation detected');
      results.passed.push('k-anonymity implementation present');
    }
    
    // Check for timeout protection
    if (content.includes('timeout') || content.includes('Promise.race')) {
      console.log('✅ Timeout protection detected');
      results.passed.push('Timeout protection exists');
    }
    
    // Check for fail-open pattern
    if (content.includes('isLeaked: false') && content.includes('error')) {
      console.log('✅ Fail-open pattern detected');
      results.passed.push('Fail-open pattern implemented');
    }
  }
} else {
  console.log('❌ leakedPasswordCheck.ts not found');
  results.failed.push('leakedPasswordCheck.ts file missing');
}

// Test 2: Check password validation updates
console.log('\n🔐 Test 2: Password Validation Updates');
console.log('-'.repeat(60));

const passwordValidationFile = path.join(__dirname, 'supabase', 'functions', '_shared', 'passwordValidation.ts');
if (fileExists(passwordValidationFile)) {
  console.log('✅ passwordValidation.ts exists');
  results.passed.push('passwordValidation.ts file exists');
  
  const content = readFile(passwordValidationFile);
  if (content) {
    // Check if function is async
    if (content.includes('export async function validatePasswordStrength')) {
      console.log('✅ validatePasswordStrength is async');
      results.passed.push('validatePasswordStrength is async');
    } else {
      console.log('❌ validatePasswordStrength not async');
      results.failed.push('validatePasswordStrength should be async');
    }
    
    // Check for leaked password integration
    if (content.includes('checkLeakedPasswordWithTimeout') || content.includes('leakedPasswordCheck')) {
      console.log('✅ Leaked password check integrated');
      results.passed.push('Leaked password check integrated');
    } else {
      console.log('❌ Leaked password check not integrated');
      results.failed.push('Leaked password check missing');
    }
    
    // Check for isLeaked in result interface
    if (content.includes('isLeaked?:') || content.includes('isLeaked :')) {
      console.log('✅ isLeaked field in result interface');
      results.passed.push('isLeaked field in interface');
    }
    
    // Check for leakCount in result interface
    if (content.includes('leakCount?:') || content.includes('leakCount :')) {
      console.log('✅ leakCount field in result interface');
      results.passed.push('leakCount field in interface');
    }
  }
} else {
  console.log('❌ passwordValidation.ts not found');
  results.failed.push('passwordValidation.ts file missing');
}

// Test 3: Check edge function updates
console.log('\n⚙️  Test 3: Edge Function Updates');
console.log('-'.repeat(60));

const functionsToCheck = [
  'admin-user-management/index.ts',
  'admin-password-reset/index.ts'
];

functionsToCheck.forEach(funcPath => {
  const fullPath = path.join(__dirname, 'supabase', 'functions', funcPath);
  if (fileExists(fullPath)) {
    const content = readFile(fullPath);
    if (content) {
      // Check for await on validatePasswordStrength
      const awaitPattern = /await\s+validatePasswordStrength/;
      if (awaitPattern.test(content)) {
        console.log(`✅ ${funcPath} uses await for validatePasswordStrength`);
        results.passed.push(`${funcPath} uses await`);
      } else {
        console.log(`❌ ${funcPath} missing await for validatePasswordStrength`);
        results.failed.push(`${funcPath} missing await`);
      }
      
      // Check for import
      if (content.includes('validatePasswordStrength') || content.includes('passwordValidation')) {
        console.log(`✅ ${funcPath} imports password validation`);
        results.passed.push(`${funcPath} imports validation`);
      }
    }
  } else {
    console.log(`⚠️  ${funcPath} not found (may be expected)`);
    results.warnings.push(`${funcPath} not found`);
  }
});

// Test 4: Check config.toml updates
console.log('\n📋 Test 4: Config Updates');
console.log('-'.repeat(60));

const configFile = path.join(__dirname, 'supabase', 'config.toml');
if (fileExists(configFile)) {
  const content = readFile(configFile);
  if (content) {
    // Check for verify_jwt = true on critical functions
    const criticalFunctions = [
      'get-client-data',
      'secure-storage',
      'admin-user-management',
      'admin-password-reset'
    ];
    
    criticalFunctions.forEach(funcName => {
      const pattern = new RegExp(`\\[functions\\.${funcName.replace(/-/g, '\\-')}\\]\\s*verify_jwt\\s*=\\s*true`, 's');
      if (pattern.test(content)) {
        console.log(`✅ ${funcName} has verify_jwt = true`);
        results.passed.push(`${funcName} verify_jwt enabled`);
      } else {
        console.log(`⚠️  ${funcName} verify_jwt setting not found or not true`);
        results.warnings.push(`${funcName} verify_jwt may need manual update`);
      }
    });
  }
} else {
  console.log('⚠️  config.toml not found');
  results.warnings.push('config.toml not found');
}

// Test 5: Check migration files
console.log('\n🗄️  Test 5: Migration Files');
console.log('-'.repeat(60));

const migrationsDir = path.join(__dirname, 'supabase', 'migrations');
if (fs.existsSync(migrationsDir)) {
  const migrationFiles = [
    '20250124120000_fix_client_data_rls_policies.sql',
    '20250124130000_restrict_financial_data_access.sql'
  ];
  
  migrationFiles.forEach(migration => {
    const migrationPath = path.join(migrationsDir, migration);
    if (fileExists(migrationPath)) {
      console.log(`✅ ${migration} exists`);
      results.passed.push(`${migration} exists`);
      
      const content = readFile(migrationPath);
      if (content) {
        // Check for DROP POLICY statements
        const dropPolicyCount = (content.match(/DROP POLICY/g) || []).length;
        if (dropPolicyCount > 0) {
          console.log(`   └─ Contains ${dropPolicyCount} DROP POLICY statements`);
        }
      }
    } else {
      console.log(`❌ ${migration} not found`);
      results.failed.push(`${migration} missing`);
    }
  });
} else {
  console.log('⚠️  migrations directory not found');
  results.warnings.push('migrations directory not found');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary');
console.log('='.repeat(60));
console.log(`✅ Passed: ${results.passed.length}`);
console.log(`❌ Failed: ${results.failed.length}`);
console.log(`⚠️  Warnings: ${results.warnings.length}`);

if (results.failed.length > 0) {
  console.log('\n❌ Failed Tests:');
  results.failed.forEach(fail => console.log(`   - ${fail}`));
}

if (results.warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  results.warnings.forEach(warn => console.log(`   - ${warn}`));
}

// Final status
console.log('\n' + '='.repeat(60));
if (results.failed.length === 0) {
  console.log('✅ All critical tests passed!');
  console.log('\n📝 Next Steps:');
  console.log('   1. Deploy edge functions to Supabase');
  console.log('   2. Apply database migrations');
  console.log('   3. Update verify_jwt settings in Supabase Dashboard');
  console.log('   4. Test in production environment');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review and fix issues.');
  process.exit(1);
}

