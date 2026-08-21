import { Module } from '@nestjs/common';
import {
  CatalogController,
  PublicCatalogController,
} from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [CatalogController, PublicCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
