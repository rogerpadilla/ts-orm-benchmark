import { Op } from 'sequelize';
import { clients } from './clients';

const { SqUser, SqCompany } = clients;

// probe: select-key | emial -> email
await SqUser.findAll({
  attributes: ['id', 'emial'],
});

// probe: where-key | companyid -> companyId
await SqUser.findAll({
  attributes: ['id'],
  where: { companyid: { [Op.gt]: 0 } },
});

// probe: where-value | 'one' -> 1
await SqUser.findAll({
  attributes: ['id'],
  where: { companyId: 'one' },
});

// probe: where-operator | [Op.like]: 'abc' -> [Op.gte]: 1
await SqUser.findAll({
  attributes: ['id'],
  where: { companyId: { [Op.like]: 'abc' } },
});

// probe: sort-key | idd -> id
await SqUser.findAll({
  attributes: ['id'],
  order: [['idd', 'ASC']],
});

// probe: nested-select-key | nmae -> name
await SqCompany.findAll({
  attributes: ['id'],
  include: [{ model: SqUser, as: 'users', attributes: ['nmae'] }],
});

// probe: insert-key | emails -> email
await SqUser.bulkCreate([{ name: 'New User', emails: 'new@example.com', companyId: 1, createdAt: 1 }]);

// probe: update-value | 42 -> 'Updated Name'
await SqUser.update({ name: 42 }, { where: { id: 1 } });

// probe: result-unselected | user.email -> user.name
const [user] = await SqUser.findAll({ attributes: ['id', 'name'] });
export const unselected = user.email;

// probe: result-nested | .nmae -> .name
const [company] = await SqCompany.findAll({
  attributes: ['id'],
  include: [{ model: SqUser, as: 'users', attributes: ['id', 'name'] }],
});
export const nested = company.users![0].nmae;
