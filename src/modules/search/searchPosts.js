const { request } = require('modules/util');
const joi = require('joi');
const ID = require('modules/id');
const { locationTypeIDs } = require('modules/constants');

// prettier-ignore
const schema = joi.object({
  page: joi.number().integer().min(0).required()
});

const feed = async (trx, { query, filter, page }) => {
  const textQuery = (query || '').trim();
  if (textQuery.replace(/[#@]/g, '').length < 1) {
    return { status: 'ok', posts: [] };
  }

  const tagQuery = `%${textQuery.replace(/#/g, '')}%`;
  const userQuery = `%${textQuery.replace(/@/g, '')}%`;
  const locationQuery = `%${textQuery}%`;

  let queryWhere = '';
  let queryItems = [];

  switch (filter) {
    case 'tag':
      queryWhere = `
        (pt.postID = p.postID AND t.tagID = pt.tagID AND t.text LIKE ?)
      `;
      queryItems = [tagQuery];
      break;
    case 'location':
      const locationID = ID.location.decode(textQuery)[0];
      if (!locationID) return { status: 'ok', posts: [] };
      queryWhere = `
        (l.locationID = ?)
      `;
      queryItems = [locationID];
      break;
    case 'user':
      queryWhere = `
        (username LIKE ?)
      `;
      queryItems = [userQuery];
      break;
    default:
      queryWhere = `
        (username LIKE ?) OR
        (pt.postID = p.postID AND t.tagID = pt.tagID AND t.text LIKE ?) OR
        (l.name LIKE ? OR l.address LIKE ?)
      `;
      queryItems = [tagQuery, userQuery, locationQuery, locationQuery];
      break;
  }

  const [result] = await trx.execute(
    `SELECT
      p.postID,
      p.locationID,
      p.text,
      p.createdAt,
      JSON_OBJECT(
        'username', u.username,
        'displayName', u.displayName
      ) as user,
      JSON_OBJECT(
        'locationTypeID', l.locationTypeID,
        'name', l.name,
        'address', l.address,
        'fileID', lf.fileID
      ) as location
    FROM post p
    JOIN user u ON u.userID = p.userID
    JOIN location l ON l.locationID = p.locationID
    LEFT JOIN postTag pt ON pt.postID = p.postID
    LEFT JOIN tag t ON t.tagID = pt.tagID
    LEFT JOIN locationFile lf ON lf.locationID = p.locationID
    WHERE
      u.userID = p.userID AND
      l.locationID = p.locationID AND
      (
        ${queryWhere}
      )
    GROUP BY p.postID
    ORDER BY p.createdAt
    DESC LIMIT ?, ?`,
    [...queryItems, Number(page) * 10, 10]
  );

  if (!result.length) {
    return { status: 'ok', posts: [] };
  }

  const [image] = await trx.query(
    'SELECT pf.fileID, pf.postID FROM postFile as pf WHERE pf.postID IN (?)',
    [result.map(x => x.postID)]
  );

  // Convert numerical id to a hash id
  const posts = result.map(x => {
    const location = JSON.parse(x.location);
    const media = image
      .filter(y => y.postID == x.postID)
      .map(y => ID.file.encode(y.fileID));

    // Set the location icon
    let icon = 'map-marker';
    if (location) {
      if (location.locationTypeID === locationTypeIDs.PARK)
        icon = 'nature-people';
      if (location.locationTypeID === locationTypeIDs.PEAK)
        icon = 'image-filter-hdr';
      if (location.locationTypeID === locationTypeIDs.ATTRACTION) icon = 'star';
      if (location.locationTypeID === locationTypeIDs.INFORMATION)
        icon = 'information';
    }

    return {
      ...x,
      postID: ID.post.encode(Number(x.postID)),
      media,
      user: JSON.parse(x.user),
      location: location
        ? {
            ...location,
            icon,
            fileID: location.fileID ? ID.file.encode(location.fileID) : null,
          }
        : null,
    };
  });

  return { status: 'ok', posts };
};

// Express POST middleware
const post = request(async (trx, req, res) => {
  const valid = joi.validate(req.body, schema);
  if (valid.error) {
    return { status: 'validation error', error: valid.error };
  }

  return await feed(trx, { ...req.params, ...req.body });
});

// Express GET middleware
const get = request(async (trx, req, res) => {
  const status = await feed(trx, { ...req.params, page: 0 });

  res.render('index', {
    posts: status.posts,
  });
});

module.exports = {
  post,
  get,
};