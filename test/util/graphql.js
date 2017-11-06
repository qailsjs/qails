import request from 'supertest';
import should from 'should';
import { range } from 'lodash';
import casual from 'casual';
import { buildSchema } from 'graphql';
import { Qails, base, Model } from '../../src';
import graphql from '../../src/middlewares/graphql';
import { fetchAll, fetchOne, create, update, destroy } from '../../src/util/graphql';

const ROW_COUNT = 15;
const TABLE_BOOKS = 'books';
const TABLE_CHAPTERS = 'chapters';

before(async () => {
  await base.knex.schema
    .dropTableIfExists(TABLE_BOOKS)
    .createTable(TABLE_BOOKS, (table) => {
      table.increments();
      table.string('name');
    })
    .dropTableIfExists(TABLE_CHAPTERS)
    .createTable(TABLE_CHAPTERS, (table) => {
      table.increments();
      table.string('name');
      table.integer('book_id');
    });

  const bookData = range(1, ROW_COUNT + 1).map(item => ({ id: item, name: casual.word }));
  const chapterData = range(1, ROW_COUNT + 1).map(item => ({
    id: item,
    name: casual.word,
    book_id: item
  }));

  await base.knex(TABLE_BOOKS).insert(bookData);
  await base.knex(TABLE_CHAPTERS).insert(chapterData);
});

// after(async () => {
//   await base.knex.schema
//     .dropTableIfExists(TABLE_BOOKS)
//     .dropTableIfExists(TABLE_CHAPTERS);
// });

describe('util::graphql', () => {
  const Chapter = class extends Model {
    get tableName() { return 'chapters'; }
    get hasTimestamps() { return false; }
  };
  const Book = class extends Model {
    get tableName() { return 'books'; }
    get hasTimestamps() { return false; }
    posts() {
      return this.hasMany(Chapter);
    }
  };

  const schema = buildSchema(`
    input BookInput {
      name: String
    }
    type Book {
      id: ID!
      name: String
      chapters: [Chapter]
    }
    type Chapter {
      id: ID!
      name: String
      book_id: Int
    }
    type Query {
      books(withRelated: String, where: [String], andWhere: [String], orWhere: [String], sort: String, page: Int, pageSize: Int, limit: Int, offset: Int): [Book]
      book(id: Int!, withRelated: String): Book
    }
    type Mutation {
      createBook(input: BookInput): Book
      updateBook(id: Int!, input: BookInput): Book
      deleteBook(id: Int!): Book
    }
  `);

  const root = {
    books: async (query) => {
      const books = await fetchAll(Book, query);
      return books;
    },
    book: async ({ id, ...query }) => {
      const book = await fetchOne(Book, id, query);
      return book;
    },
    createBook: async ({ input }) => {
      const book = await create(Book, input);
      return book;
    },
    updateBook: async ({ id, input }) => {
      const book = await update(Book, id, input);
      return book;
    },
    deleteBook: async ({ id }) => {
      const book = await destroy(Book, id);
      return book;
    }
  };

  const app = new Qails([
    graphql({
      schema,
      rootValue: root
    })
  ]);

  it('应该返回所有记录', async () => {
    const query = `query {
      books {
        id
      }
    }`;
    const { body: { data: { books } } } = await request(app.listen()).post('/graphql').send({ query });
    should(books).not.empty();
    books.should.have.length(ROW_COUNT);
  });

  it('应该返回ID>10的记录', async () => {
    const query = `query {
      books(where: ["id", ">", "10"]) {
        id
      }
    }`;
    const { body: { data: { books } } } = await request(app.listen()).post('/graphql').send({ query });
    should(books).not.empty();
    books.should.have.length(5);
  });

  it('应该返回ID=5的记录', async () => {
    const query = `query {
      book(id: 5) {
        id
      }
    }`;
    const { body: { data: { book } } } = await request(app.listen()).post('/graphql').send({ query });
    should(book).not.empty();
    book.should.have.property('id', '5');
  });

  it('新增记录应该成功', async () => {
    const query = `mutation CreateBook($input: BookInput) {
      createBook(input: $input) {
        id
        name
      }
    }`;
    const name = casual.word;
    const res = await request(app.listen()).post('/graphql').send({
      query,
      variables: {
        input: {
          name
        }
      }
    });
    const { body: { data: { createBook } } } = res;
    createBook.should.have.property('id', (ROW_COUNT + 1).toString());
    createBook.should.have.property('name', name);
  });

  it('修改记录应该成功', async () => {
    const query = `mutation UpdateBook($id: Int!, $input: BookInput) {
      updateBook(id: $id, input: $input) {
        id
        name
      }
    }`;
    const id = '1';
    const name = casual.word;
    const res = await request(app.listen()).post('/graphql').send({
      query,
      variables: {
        id,
        input: {
          name
        }
      }
    });
    const { body: { data: { updateBook } } } = res;
    updateBook.should.have.property('id', '1');
    updateBook.should.have.property('name', name);
  });

  it('修改不存在的记录应该返回错误信息', async () => {
    const query = `mutation UpdateBook($id: Int!, $input: BookInput) {
      updateBook(id: $id, input: $input) {
        id
        name
      }
    }`;
    const id = '100';
    const name = casual.word;
    const { body: { errors } } = await request(app.listen()).post('/graphql').send({
      query,
      variables: {
        id,
        input: {
          name
        }
      }
    });
    should(errors).not.be.undefined();
    errors.should.have.length(1);
  });

  it('删除记录应该成功', async () => {
    const query = `mutation DeleteBook($id: Int!) {
      deleteBook(id: $id) {
        id
        name
      }
    }`;
    const id = '1';
    const res = await request(app.listen()).post('/graphql').send({
      query,
      variables: { id }
    });
    const { body: { data: { deleteBook } } } = res;
    deleteBook.should.not.be.empty();
    deleteBook.should.have.property('id', id);

    const count = await Book.forge().query({ where: { id } }).count();
    count.should.eql(0);
  });
});