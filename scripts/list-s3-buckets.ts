/**
 * List available S3 buckets
 */

import dotenv from "dotenv";
dotenv.config();

import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

async function main() {
  console.log("=== Listing S3 Buckets ===\n");

  const client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  try {
    const result = await client.send(new ListBucketsCommand({}));

    if (result.Buckets && result.Buckets.length > 0) {
      console.log("Available buckets:");
      for (const bucket of result.Buckets) {
        console.log(`  - ${bucket.Name}`);
      }
    } else {
      console.log("No buckets found.");
    }
  } catch (error) {
    console.error("Error listing buckets:", error);
  }
}

main();
