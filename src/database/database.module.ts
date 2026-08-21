import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Environment } from '../config/environment';
import { CLOCK_MODEL_DEFINITIONS } from './models';
import { DatabaseService } from './database.service';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        autoIndex: false,
        minPoolSize: config.get('MONGODB_MIN_POOL_SIZE', { infer: true }),
        maxPoolSize: config.get('MONGODB_MAX_POOL_SIZE', { infer: true }),
        serverSelectionTimeoutMS: config.get(
          'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
          { infer: true },
        ),
        socketTimeoutMS: config.get('MONGODB_SOCKET_TIMEOUT_MS', {
          infer: true,
        }),
      }),
    }),
    MongooseModule.forFeature(CLOCK_MODEL_DEFINITIONS),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, MongooseModule],
})
export class DatabaseModule {}
