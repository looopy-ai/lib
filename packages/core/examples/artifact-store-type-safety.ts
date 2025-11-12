/**
 * Artifact Store - Type Safety Example
 *
 * Demonstrates the benefits of using discriminated unions for artifact types.
 * The type system now enforces correct usage at compile time.
 */

import type { DataArtifact, DatasetArtifact, FileArtifact } from '../src/core/types';
import { InMemoryArtifactStore } from '../src/stores/artifacts';

async function main() {
  const store = new InMemoryArtifactStore();

  console.log('=== Artifact Store: Type Safety Demo ===\n');

  // ============================================================================
  // Example 1: Type-safe file artifact creation
  // ============================================================================
  console.log('Example 1: File Artifact with Type Safety');
  console.log('------------------------------------------');

  const fileId = await store.createFileArtifact({
    artifactId: 'doc-1',
    taskId: 'task-1',
    contextId: 'ctx-1',
    name: 'README.md',
    mimeType: 'text/markdown',
    encoding: 'utf-8',
  });

  // Append chunks
  await store.appendFileChunk('ctx-1', fileId, '# My Document\n');
  await store.appendFileChunk('ctx-1', fileId, '\n## Introduction\n');
  await store.appendFileChunk('ctx-1', fileId, '\nThis is a test.', { isLastChunk: true });

  // Type narrowing with discriminated union
  const fileArtifact = await store.getArtifact('ctx-1', fileId);
  if (fileArtifact && fileArtifact.type === 'file') {
    // TypeScript knows fileArtifact has 'chunks', 'mimeType', 'encoding'
    console.log(`File: ${fileArtifact.name}`);
    console.log(`MIME Type: ${fileArtifact.mimeType}`);
    console.log(`Encoding: ${fileArtifact.encoding}`);
    console.log(`Chunks: ${fileArtifact.chunks.length}`);
    console.log(`Total Size: ${fileArtifact.totalSize} bytes`);
    console.log(`Status: ${fileArtifact.status}\n`);

    // Type-safe access to file-specific content
    const content = await store.getFileContent('ctx-1', fileId);
    console.log(`Content:\n${content}\n`);
  }

  // ============================================================================
  // Example 2: Type-safe data artifact creation
  // ============================================================================
  console.log('Example 2: Data Artifact with Type Safety');
  console.log('------------------------------------------');

  const dataId = await store.createDataArtifact({
    artifactId: 'config-1',
    taskId: 'task-1',
    contextId: 'ctx-1',
    name: 'app-config',
  });

  // Write data atomically
  await store.writeData('ctx-1', dataId, {
    environment: 'production',
    database: {
      host: 'db.example.com',
      port: 5432,
    },
    features: {
      auth: true,
      analytics: false,
    },
  });

  // Type narrowing
  const dataArtifact = await store.getArtifact('ctx-1', dataId);
  if (dataArtifact && dataArtifact.type === 'data') {
    // TypeScript knows dataArtifact has 'data' field
    console.log(`Data: ${dataArtifact.name}`);
    console.log(`Version: ${dataArtifact.version}`);
    console.log(`Status: ${dataArtifact.status}`);

    // Type-safe access to data-specific content
    const data = await store.getDataContent('ctx-1', dataId);
    console.log(`Data Content:`, JSON.stringify(data, null, 2));
    console.log();
  }

  // ============================================================================
  // Example 3: Type-safe dataset artifact creation
  // ============================================================================
  console.log('Example 3: Dataset Artifact with Type Safety');
  console.log('---------------------------------------------');

  const datasetId = await store.createDatasetArtifact({
    artifactId: 'sales-1',
    taskId: 'task-1',
    contextId: 'ctx-1',
    name: 'Q4 Sales',
    schema: {
      columns: [
        { name: 'date', type: 'date' },
        { name: 'product', type: 'string' },
        { name: 'revenue', type: 'number' },
      ],
    },
  });

  // Append batches of rows
  await store.appendDatasetBatch('ctx-1', datasetId, [
    { date: '2024-10-01', product: 'Widget A', revenue: 1500 },
    { date: '2024-10-02', product: 'Widget B', revenue: 2300 },
  ]);

  await store.appendDatasetBatch(
    'ctx-1',
    datasetId,
    [
      { date: '2024-10-03', product: 'Widget A', revenue: 1800 },
      { date: '2024-10-04', product: 'Widget C', revenue: 3100 },
    ],
    { isLastBatch: true },
  );

  // Type narrowing
  const datasetArtifact = await store.getArtifact('ctx-1', datasetId);
  if (datasetArtifact && datasetArtifact.type === 'dataset') {
    // TypeScript knows datasetArtifact has 'rows', 'schema', 'totalChunks'
    console.log(`Dataset: ${datasetArtifact.name}`);
    console.log(`Schema: ${datasetArtifact.schema?.columns.length} columns`);
    console.log(`Batches: ${datasetArtifact.totalChunks}`);
    console.log(`Total Rows: ${datasetArtifact.totalSize}`);
    console.log(`Status: ${datasetArtifact.status}`);

    // Type-safe access to dataset-specific content
    const rows = await store.getDatasetRows('ctx-1', datasetId);
    console.log(`Rows:`, JSON.stringify(rows, null, 2));
    console.log();
  }

  // ============================================================================
  // Example 4: Type safety prevents errors at compile time
  // ============================================================================
  console.log('Example 4: Compile-Time Type Safety');
  console.log('------------------------------------');

  // Get an artifact
  const artifact = await store.getArtifact('ctx-1', fileId);

  if (artifact) {
    // Without type narrowing, TypeScript doesn't allow access to type-specific fields
    // This would be a compile error:
    // console.log(artifact.chunks); // Error: Property 'chunks' does not exist on type 'StoredArtifact'

    // Type narrowing enables safe access
    if (artifact.type === 'file') {
      console.log(`✓ File artifact has ${artifact.chunks.length} chunks`);
      // TypeScript knows: artifact is FileArtifact
      const totalBytes = artifact.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
      console.log(`  Total bytes from chunks: ${totalBytes}`);
    } else if (artifact.type === 'data') {
      console.log(`✓ Data artifact version: ${artifact.version}`);
      // TypeScript knows: artifact is DataArtifact
      const dataKeys = Object.keys(artifact.data);
      console.log(`  Data keys: ${dataKeys.join(', ')}`);
    } else if (artifact.type === 'dataset') {
      console.log(`✓ Dataset has ${artifact.rows.length} rows`);
      // TypeScript knows: artifact is DatasetArtifact
      const columnNames = artifact.schema?.columns.map((c) => c.name) || [];
      console.log(`  Columns: ${columnNames.join(', ')}`);
    }
  }

  console.log();

  // ============================================================================
  // Example 5: Helper function with type guards
  // ============================================================================
  console.log('Example 5: Type Guards and Helper Functions');
  console.log('--------------------------------------------');

  // Type guard functions for cleaner code
  function isFileArtifact(
    artifact: FileArtifact | DataArtifact | DatasetArtifact,
  ): artifact is FileArtifact {
    return artifact.type === 'file';
  }

  function isDataArtifact(
    artifact: FileArtifact | DataArtifact | DatasetArtifact,
  ): artifact is DataArtifact {
    return artifact.type === 'data';
  }

  function isDatasetArtifact(
    artifact: FileArtifact | DataArtifact | DatasetArtifact,
  ): artifact is DatasetArtifact {
    return artifact.type === 'dataset';
  }

  // Helper to get artifact size in a type-safe way
  function getArtifactSize(artifact: FileArtifact | DataArtifact | DatasetArtifact): number {
    if (isFileArtifact(artifact)) {
      return artifact.totalSize; // bytes
    } else if (isDataArtifact(artifact)) {
      return JSON.stringify(artifact.data).length; // bytes
    } else if (isDatasetArtifact(artifact)) {
      return artifact.totalSize; // rows
    }
    return 0;
  }

  // Use the helpers
  const allArtifacts = [fileArtifact, dataArtifact, datasetArtifact].filter((a) => a !== null) as (
    | FileArtifact
    | DataArtifact
    | DatasetArtifact
  )[];

  for (const art of allArtifacts) {
    console.log(
      `${art.name}: ${getArtifactSize(art)} ${isFileArtifact(art) || isDataArtifact(art) ? 'bytes' : 'rows'}`,
    );
  }

  console.log();

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('=== Summary ===');
  console.log('Benefits of discriminated unions:');
  console.log('1. Compile-time type safety - catch errors before runtime');
  console.log('2. Better IDE autocomplete - knows which fields exist');
  console.log('3. No optional fields pollution - each type has only what it needs');
  console.log('4. Type narrowing - TypeScript infers the specific type');
  console.log("5. Clearer code - explicit about which type you're working with");
}

main().catch(console.error);
