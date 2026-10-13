import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../dist/app.module.js';

describe('Indexer health (e2e)', () => {
  let app: INestApplication<App>;
  const originalIndexerEnabled = process.env.INDEXER_ENABLED;

  beforeAll(() => { process.env.INDEXER_ENABLED = 'false'; });
  afterAll(() => {
    if (originalIndexerEnabled === undefined) delete process.env.INDEXER_ENABLED;
    else process.env.INDEXER_ENABLED = originalIndexerEnabled;
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('reports database readiness', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ status: 'ok', service: 'indexer-service', database: 'connected' });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
