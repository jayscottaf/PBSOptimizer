const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5000').replace(
  /\/$/,
  ''
);
const packageOverride = process.env.SMOKE_BID_PACKAGE_ID
  ? Number(process.env.SMOKE_BID_PACKAGE_ID)
  : undefined;

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${response.url}, got: ${text.slice(0, 120)}`);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...options,
  });
  const data = await readJson(response);

  if (!response.ok) {
    const message = data?.message || response.statusText;
    throw new Error(`${path} failed (${response.status}): ${message}`);
  }

  return data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log(`Smoke test target: ${baseUrl}`);

  const health = await request('/api/health');
  assert(health.status === 'ok', `Expected health status ok, got ${health.status}`);
  assert(
    health.database === 'connected',
    `Expected connected database, got ${health.database}`
  );
  console.log('✓ health endpoint reports connected database');

  const bidPackages = await request('/api/bid-packages');
  assert(Array.isArray(bidPackages), 'Expected /api/bid-packages to return an array');
  assert(bidPackages.length > 0, 'Expected at least one bid package');

  const selectedPackage = packageOverride
    ? bidPackages.find(pkg => pkg.id === packageOverride)
    : bidPackages.find(pkg => pkg.status === 'completed') || bidPackages[0];

  assert(
    selectedPackage,
    packageOverride
      ? `No bid package found for SMOKE_BID_PACKAGE_ID=${packageOverride}`
      : 'No bid package found'
  );
  assert(
    selectedPackage.status === 'completed',
    `Selected bid package ${selectedPackage.id} is ${selectedPackage.status}, expected completed`
  );
  console.log(
    `✓ selected completed bid package ${selectedPackage.id}: ${selectedPackage.month} ${selectedPackage.year}`
  );

  const dataHealth = await request('/api/data-health');
  assert(
    dataHealth?.bidPackages?.total >= 1,
    'Expected data-health to include bid package metadata'
  );
  assert(
    Array.isArray(dataHealth.bidPackages.list),
    'Expected data-health bidPackages.list array'
  );
  console.log('✓ data-health endpoint returns package metadata');

  const search = await request('/api/pairings/search', {
    method: 'POST',
    body: JSON.stringify({
      bidPackageId: selectedPackage.id,
      limit: 5,
      page: 1,
    }),
  });
  assert(Array.isArray(search.pairings), 'Expected pairings/search pairings array');
  assert(search.pairings.length > 0, 'Expected pairings/search to return pairings');
  console.log(`✓ pairings search returned ${search.pairings.length} pairings`);

  console.log('Smoke test passed.');
}

main().catch(error => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exit(1);
});
