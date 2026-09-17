import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [AuditModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
