import { MongoClient } from 'mongodb';

/** Connect MongoDB and ensure the idempotency indexes exist. */
export async function connectDatabase(uri, databaseName = 'heartbeat') {
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  const db = client.db(databaseName);
  await Promise.all([
    db.collection('chunks').createIndex({ session: 1, sensor: 1, first_index: 1 }, { unique: true }),
    db.collection('losses').createIndex({ session: 1, sensor: 1, from_index: 1, reason: 1 }, { unique: true }),
    db.collection('results').createIndex({ session: 1, window: 1, mode: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ id: 1 }, { unique: true }),
  ]);
  return { client, db };
}
