/**
 * `AuditLogService`, exported to every module that mutates something.
 *
 * It is its own module rather than a provider repeated in each feature module so
 * that there is exactly one instance and one place the write is defined —
 * Tasks 13 and onwards import this, they do not re-declare it.
 */

import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
