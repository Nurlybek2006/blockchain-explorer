import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../dist/app.module.js';

describe('Portfolio service health (e2e)', () => {
  let app: INestApplication<App>;
  const previousScheduler = process.env.PRICE_SCHEDULER_ENABLED;
  beforeAll(() => { process.env.PRICE_SCHEDULER_ENABLED = 'false'; });
  afterAll(() => {
    if (previousScheduler === undefined) delete process.env.PRICE_SCHEDULER_ENABLED;
    else process.env.PRICE_SCHEDULER_ENABLED = previousScheduler;
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('reports database, BullMQ and RabbitMQ readiness', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ status: 'ok', service: 'portfolio-service', database: 'connected', redis: 'connected', rabbitmq: 'connected' });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
