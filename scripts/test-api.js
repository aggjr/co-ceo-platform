async function test() {
  try {
    console.log('Logging in...');
    const loginRes = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@coceo.com.br',
        password: 'Dani160779!',
      }),
    });
    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log('Login successful! Token:', token ? 'OK' : 'FAIL');
    if (!token) return;

    console.log('Calling platform contracts...');
    const contractsRes = await fetch('http://localhost:3001/api/cockpit/platform/contracts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const contractsData = await contractsRes.json();
    console.log('Contracts count:', contractsData.contracts?.length);

    if (contractsData.contracts?.length > 0) {
      const contractId = contractsData.contracts[0].id;
      console.log(`Calling IAM for contract ${contractId}...`);
      const iamRes = await fetch(`http://localhost:3001/api/cockpit/platform/contracts/${contractId}/iam`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const iamData = await iamRes.json();
      console.log('IAM Data success:', iamData.success);
      console.log('IAM keys:', Object.keys(iamData));
    }

    console.log('Calling platform org-tree...');
    const treeRes = await fetch('http://localhost:3001/api/cockpit/platform/org-tree', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const treeData = await treeRes.json();
    console.log('Org-tree nodes count:', treeData.nodes?.length);
    if (treeData.nodes) {
      console.log('Sample node name:', treeData.nodes[0]?.name);
    }
  } catch (error) {
    console.error('Error during API test:', error.message);
  }
}

test();
