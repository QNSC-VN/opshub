import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { TerminusModule } from '@nestjs/terminus';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { RequestContextService } from './context/request-context';
import { JwtStrategy } from './auth/jwt.strategy';
import { JwtAuthGuard } from './auth/jwt.guard';
import { RoleGuard } from './auth/role.guard';
import { ScopeEvaluator } from './auth/scope-evaluator';
import { AuthzService } from './auth/authz.service';
import { PolicyGuard } from './auth/policy.guard';
import { RequestRegistry } from './requests/request-registry';
import { RequestEngine } from './requests/request-engine.service';
import { OutboxService } from './outbox/outbox.service';
import { HealthController } from './observability/health.controller';
import { HttpLoggingInterceptor } from './http/http-logging.interceptor';
import { CacheService } from './cache/cache.service';
import { ResilienceService } from './resilience/resilience.service';
import { EMAIL_PROVIDER } from './email/email.provider';
import { DevEmailProvider } from './email/providers/dev.provider';
import { ResendEmailProvider } from './email/providers/resend.provider';
import { EmailService } from './email/email.service';
import { EmailSchedulerService } from './email/email-scheduler.service';
import { NotificationSchedulerService } from './notifications/notification-scheduler.service';
import { NotificationPubSubService } from './notifications/notification-pubsub.service';
import { DelegationService } from './authz/delegation.service';
import { WebhookEnqueueService } from './webhooks/webhook-enqueue.service';
import { StorageService } from './storage/storage.service';

/**
 * Platform module — cross-cutting infrastructure shared by every bounded context:
 * config, database, auth, outbox, health, logging, cache, resilience.
 * Imported once by AppModule.
 */
@Global()
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        privateKey: config.get('JWT_PRIVATE_KEY'),
        publicKey: config.get('JWT_PUBLIC_KEY'),
        signOptions: {
          algorithm: 'ES256',
          expiresIn: config.get('JWT_ACCESS_EXPIRY') as unknown as number,
          issuer: config.get('JWT_ISSUER'),
          audience: config.get('JWT_AUDIENCE'),
        },
        verifyOptions: {
          algorithms: ['ES256'],
          issuer: config.get('JWT_ISSUER'),
          audience: config.get('JWT_AUDIENCE'),
        },
      }),
    }),
    TerminusModule,
  ],
  controllers: [HealthController],
  providers: [
    RequestContextService,
    JwtStrategy,
    JwtAuthGuard,
    RoleGuard,
    ScopeEvaluator,
    AuthzService,
    PolicyGuard,
    RequestRegistry,
    RequestEngine,
    OutboxService,
    HttpLoggingInterceptor,
    CacheService,
    ResilienceService,
    {
      provide: EMAIL_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const provider = config.get('EMAIL_PROVIDER');
        if (provider === 'resend') {
          const apiKey = config.get('RESEND_API_KEY');
          if (!apiKey) throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
          return new ResendEmailProvider(apiKey);
        }
        return new DevEmailProvider();
      },
    },
    EmailService,
    EmailSchedulerService,
    NotificationSchedulerService,
    NotificationPubSubService,
    DelegationService,
    WebhookEnqueueService,
    StorageService,
  ],
  exports: [
    StorageService,
    AppConfigModule,
    DatabaseModule,
    JwtModule,
    RequestContextService,
    JwtAuthGuard,
    RoleGuard,
    ScopeEvaluator,
    AuthzService,
    PolicyGuard,
    RequestRegistry,
    RequestEngine,
    OutboxService,
    HttpLoggingInterceptor,
    CacheService,
    ResilienceService,
    EmailService,
    EmailSchedulerService,
    NotificationSchedulerService,
    NotificationPubSubService,
    DelegationService,
    WebhookEnqueueService,
  ],
})
export class PlatformModule {}
