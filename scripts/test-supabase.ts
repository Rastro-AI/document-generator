/**
 * Test Supabase connection and storage
 */

import dotenv from "dotenv";
dotenv.config();

import { getSupabaseClient, ensureBucketsExist, BUCKETS } from "../src/lib/supabase";

async function main() {
  console.log("=== Test Supabase Storage ===\n");

  console.log("1. Testing connection...");
  const client = getSupabaseClient();
  console.log("   Client created");

  console.log("\n2. Listing existing buckets...");
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) {
    console.log(`   Error: ${listError.message}`);
  } else {
    console.log(`   Found ${buckets?.length || 0} buckets:`);
    for (const bucket of buckets || []) {
      console.log(`     - ${bucket.name} (public: ${bucket.public})`);
    }
  }

  console.log("\n3. Ensuring required buckets exist...");
  try {
    await ensureBucketsExist();
    console.log("   Buckets ensured");
  } catch (err) {
    console.log(`   Error: ${err}`);
  }

  console.log("\n4. Testing file upload...");
  const testContent = Buffer.from(`Test content - ${new Date().toISOString()}`);
  const testPath = "test/hello.txt";

  const { error: uploadError } = await client.storage
    .from(BUCKETS.TEMPLATES)
    .upload(testPath, testContent, {
      upsert: true,
      contentType: "text/plain",
    });

  if (uploadError) {
    console.log(`   Upload error: ${uploadError.message}`);
  } else {
    console.log(`   Uploaded to ${BUCKETS.TEMPLATES}/${testPath}`);
  }

  console.log("\n5. Testing file download...");
  const { data: downloadData, error: downloadError } = await client.storage
    .from(BUCKETS.TEMPLATES)
    .download(testPath);

  if (downloadError) {
    console.log(`   Download error: ${downloadError.message}`);
  } else {
    const content = await downloadData?.text();
    console.log(`   Downloaded: "${content}"`);
  }

  console.log("\n6. Listing files in bucket...");
  const { data: files, error: filesError } = await client.storage
    .from(BUCKETS.TEMPLATES)
    .list("test");

  if (filesError) {
    console.log(`   List error: ${filesError.message}`);
  } else {
    console.log(`   Files in test/:`);
    for (const file of files || []) {
      console.log(`     - ${file.name} (${file.metadata?.size || 0} bytes)`);
    }
  }

  console.log("\n7. Cleaning up test file...");
  const { error: deleteError } = await client.storage
    .from(BUCKETS.TEMPLATES)
    .remove([testPath]);

  if (deleteError) {
    console.log(`   Delete error: ${deleteError.message}`);
  } else {
    console.log(`   Deleted ${testPath}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
