async function test() {
    console.log("Fetching health/db...");
    try {
        const dbHealth = await fetch('http://127.0.0.1:8000/health/db');
        console.log("DB Health:", await dbHealth.text());
    } catch (e) { console.error("DB Error:", e.message) }

    console.log("Fetching health/qdrant...");
    try {
        const qdrantHealth = await fetch('http://127.0.0.1:8000/health/qdrant');
        console.log("Qdrant Health:", await qdrantHealth.text());
    } catch (e) { console.error("Qdrant Error:", e.message) }

    console.log("Registering customer...");
    try {
        const reg = await fetch('http://127.0.0.1:8000/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: "test-tenant-3",
                name: "Test Tenant 3",
                email: "test3@example.com",
                password: "password"
            })
        });
        console.log("Reg result:", await reg.text());
    } catch (e) { console.error("Reg Error:", e.message) }
}

test();
