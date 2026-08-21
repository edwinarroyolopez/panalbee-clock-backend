import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import {
  CatalogController,
  PublicCatalogController,
} from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [AccountsModule],
  controllers: [CatalogController, PublicCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
