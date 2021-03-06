const { request } = require('modules/util');
const joi = require('joi');
const ID = require('modules/id');
const { locationTypeIDs, fileTypeIDs } = require('modules/constants');
const emoji = require('modules/postReact/emoji');

// prettier-ignore
const schema = joi.object({
  page: joi.number().integer().min(0).required()
});

const feed = async (trx, { page, userID, filter = null }) => {
  let filterData = [];

  if (filter && filter.username) {
    filterData = [filter.username];
  }

  if (filter && filter.personal) {
    filterData = [userID];
  }

  if (filter && filter.collection) {
    filterData = [filter.collection];
  }

  //Feed for anonymous users, ordered by date
  const [result] = await trx.execute(
    `SELECT
      p.postID,
      p.locationID,
      p.text,
      p.createdAt,
      JSON_OBJECT(
        'username', u.username,
        'displayName', u.displayName,
        'image', uf.fileID
        ${userID ? `,'following', f.followerID` : ''}
      ) as user
    FROM post p, user u
    LEFT JOIN userFile uf ON uf.userID = u.userID
    ${
      userID
        ? 'LEFT JOIN follower f ON f.followerID = ? AND f.userID = u.userID'
        : ''
    }
    WHERE u.userID = p.userID ${
      filter && filter.username ? 'AND u.username = ?' : ''
    }
    ${
      filter && filter.admin
        ? 'AND (SELECT COUNT(f.flagID) FROM flag f WHERE f.postID = p.postID LIMIT 1) > 0'
        : ''
    }
    ${
      filter && filter.personal
        ? 'AND (SELECT COUNT(f.followerID) FROM follower f WHERE f.followerID = ? AND f.userID = u.userID LIMIT 1) > 0'
        : ''
    }
    ${
      filter && filter.collection
        ? `AND (SELECT COUNT(cp.postID) FROM collectionPost cp 
          WHERE cp.collectionID = ? AND cp.postID = p.postID LIMIT 1) > 0`
        : ''
    }
    ORDER BY createdAt
    DESC LIMIT ?, ?`,
    [...(userID ? [userID] : []), ...filterData, Number(page) * 10, 10]
  );

  if (result.length <= 0) {
    return { status: 'ok', posts: [] };
  }

  // Load post location
  let locations = [];
  const locationIDs = result.map(x => x.locationID);
  if (locationIDs.length > 0) {
    const [locationList] = await trx.query(
      `SELECT
      l.locationID,
      l.locationTypeID,
      l.name,
      l.address,
      lf.fileID
    FROM location l
    LEFT JOIN locationFile lf ON lf.locationID = l.locationID
    WHERE l.locationID IN (?)`,
      [locationIDs]
    );

    locations = locationList;
  }

  // Load post reacts
  const reacts = {};
  for (const post of result) {
    const [reactList] = await trx.query(
      `SELECT
        postID,
        reactID,
        COUNT(reactID) as amount
      FROM postReact
      WHERE postID = ?
      GROUP BY reactID
      ORDER BY amount
      LIMIT 5`,
      [post.postID]
    );
    reacts[post.postID] = reactList;
  }

  // Load user reacts
  let userReacts = null;
  if (userID) {
    const [uReacts] = await trx.query(
      `SELECT
        postID,
        reactID
      FROM postReact
      WHERE postID IN (?) AND userID = ?`,
      [result.map(x => x.postID), userID]
    );

    userReacts = uReacts.map(x => ({
      postID: x.postID,
      text: emoji.key[x.reactID],
    }));
  }

  const [image] = await trx.query(
    'SELECT pf.fileID, pf.postID, f.fileTypeID, f.mimeType FROM postFile pf, file f WHERE pf.postID IN (?) AND f.fileID = pf.fileID',
    [result.map(x => x.postID)]
  );

  // Convert numerical id to a hash id
  const posts = result.map(x => {
    const location = locations.find(y => x.locationID === y.locationID);
    const media = image
      .filter(y => y.postID == x.postID)
      .map(y => {
        let type = null;
        if (y.fileTypeID === fileTypeIDs.IMAGE) type = 'image';
        if (y.fileTypeID === fileTypeIDs.VIDEO) type = 'video';
        return { fileID: ID.file.encode(y.fileID), type, mimeType: y.mimeType };
      });

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

    const userObject = JSON.parse(x.user);

    return {
      ...x,
      postID: ID.post.encode(Number(x.postID)),
      media,
      user: {
        ...userObject,
        image: ID.file.encode(userObject.image),
        following: !!Number(userObject.following),
      },
      userReact: ((userReacts || []).find(y => y.postID === x.postID) || {})
        .text,
      reacts: (reacts[x.postID] || []).map(y => ({
        text: emoji.key[y.reactID],
        amount: y.amount,
      })),
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

  return await feed(trx, { ...req.body, ...(req.session || {}) });
});

// Express GET middleware
const get = request(async (trx, req, res) => {
  const status = await feed(trx, { ...(req.session || {}), page: 0 });

  res.render('index', {
    posts: status.posts,
  });
});

module.exports = {
  feed,
  post,
  get,
};
