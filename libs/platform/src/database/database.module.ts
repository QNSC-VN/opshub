import { Global, Module } from '@nestjs/common';
import { DRIZZLE, DrizzleProvider } from './drizzle.provider';

@Global()
@Module({
  providers: [
    DrizzleProvider,
    { provide: DRIZZLE, useFactory: (p: DrizzleProvider) => p.instance, inject: [DrizzleProvider] },
  ],
  exports: [DRIZZLE, DrizzleProvider],
})
export class DatabaseModule {}
