import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import { ClockModels, clockModels } from './models';

export type TransactionWork<T> = (session: ClientSession) => Promise<T>;

@Injectable()
export class DatabaseService {
  readonly models: ClockModels;

  constructor(@InjectConnection() readonly connection: Connection) {
    this.models = clockModels(connection);
  }

  async withTransaction<T>(work: TransactionWork<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(work, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });
    } finally {
      await session.endSession();
    }
  }

  async ping(): Promise<void> {
    const database = this.connection.db;
    if (!database) throw new Error('MongoDB connection is not ready');
    await database.admin().command({ ping: 1 });
  }

  async assertReplicaSet(): Promise<void> {
    const database = this.connection.db;
    if (!database) throw new Error('MongoDB connection is not ready');
    const hello = (await database.admin().command({ hello: 1 })) as {
      setName?: string;
      logicalSessionTimeoutMinutes?: number;
    };
    if (
      !hello.setName ||
      typeof hello.logicalSessionTimeoutMinutes !== 'number'
    ) {
      throw new Error('MongoDB must be a transaction-capable replica set');
    }
  }
}
