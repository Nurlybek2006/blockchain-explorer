import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../dist/app.module.js';

describe('API Gateway health (e2e)', () => {
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

  it('reports database and Redis readiness', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ status: 'ok', service: 'api-gateway', database: 'connected', redis: 'connected' });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
