import pg from 'pg';
import { ProductTaxonomyService } from './ProductTaxonomyService.js';

const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD});
try{
  const service=new ProductTaxonomyService({pool});
  console.log(JSON.stringify(await service.classifyAll({apply:process.argv.includes('--apply')})));
}finally{await pool.end();}
