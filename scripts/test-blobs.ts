/**
 * Test script for blob upload/download endpoints
 * Run with: DATABASE_URL=postgresql://postgres:postgres@localhost:5433/handy npx tsx scripts/test-blobs.ts
 */

import { PrismaClient } from '@prisma/client';
import * as privacyKit from 'privacy-kit';

const db = new PrismaClient();

async function main() {
    console.log('=== Blob Endpoint Test ===\n');

    // 1. Create auth token generator
    const generator = await privacyKit.createPersistentTokenGenerator({
        service: 'handy',
        seed: 'your-super-secret-key-for-local-development' // from .env.dev
    });

    // 2. Create test account
    const testPublicKey = 'test-public-key-' + Date.now();
    let account = await db.account.findFirst({ where: { publicKey: testPublicKey } });
    if (!account) {
        account = await db.account.create({
            data: { publicKey: testPublicKey }
        });
        console.log('Created test account:', account.id);
    } else {
        console.log('Using existing account:', account.id);
    }

    // 3. Create auth token
    const token = await generator.new({ user: account.id });
    console.log('Auth token:', token.substring(0, 50) + '...');

    // 4. Create test session
    const sessionTag = 'test-session-' + Date.now();
    let session = await db.session.findFirst({
        where: { accountId: account.id, tag: sessionTag }
    });
    if (!session) {
        session = await db.session.create({
            data: {
                accountId: account.id,
                tag: sessionTag,
                metadata: '{}',
            }
        });
        console.log('Created test session:', session.id);
    } else {
        console.log('Using existing session:', session.id);
    }

    // 5. Test blob upload
    console.log('\n--- Testing Blob Upload ---');
    const testImageData = Buffer.from('fake-encrypted-image-data-' + Date.now());

    const uploadResponse = await fetch(`http://localhost:3005/v1/sessions/${session.id}/blobs`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'X-Blob-MimeType': 'image/png',
            'X-Blob-Size': testImageData.length.toString(),
        },
        body: testImageData,
    });

    if (!uploadResponse.ok) {
        const error = await uploadResponse.text();
        console.error('Upload failed:', uploadResponse.status, error);
        process.exit(1);
    }

    const uploadResult = await uploadResponse.json() as { blobId: string; size: number };
    console.log('Upload successful:', uploadResult);

    // 6. Test blob download
    console.log('\n--- Testing Blob Download ---');
    const downloadResponse = await fetch(
        `http://localhost:3005/v1/sessions/${session.id}/blobs/${uploadResult.blobId}`,
        {
            headers: { 'Authorization': `Bearer ${token}` }
        }
    );

    if (!downloadResponse.ok) {
        const error = await downloadResponse.text();
        console.error('Download failed:', downloadResponse.status, error);
        process.exit(1);
    }

    const downloadedData = Buffer.from(await downloadResponse.arrayBuffer());
    console.log('Downloaded size:', downloadedData.length);
    console.log('X-Blob-MimeType:', downloadResponse.headers.get('X-Blob-MimeType'));
    console.log('X-Blob-Size:', downloadResponse.headers.get('X-Blob-Size'));
    console.log('Data matches:', testImageData.equals(downloadedData));

    // 7. Test blob delete
    console.log('\n--- Testing Blob Delete ---');
    const deleteResponse = await fetch(
        `http://localhost:3005/v1/sessions/${session.id}/blobs/${uploadResult.blobId}`,
        {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        }
    );

    if (!deleteResponse.ok) {
        const error = await deleteResponse.text();
        console.error('Delete failed:', deleteResponse.status, error);
        process.exit(1);
    }

    const deleteResult = await deleteResponse.json();
    console.log('Delete successful:', deleteResult);

    // 8. Verify blob is gone
    console.log('\n--- Verifying Blob Deleted ---');
    const verifyResponse = await fetch(
        `http://localhost:3005/v1/sessions/${session.id}/blobs/${uploadResult.blobId}`,
        {
            headers: { 'Authorization': `Bearer ${token}` }
        }
    );
    console.log('Get deleted blob status:', verifyResponse.status, '(expected 404)');

    // Cleanup
    await db.session.delete({ where: { id: session.id } });
    await db.account.delete({ where: { id: account.id } });
    console.log('\nCleaned up test data');

    console.log('\n=== All Tests Passed! ===');
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
