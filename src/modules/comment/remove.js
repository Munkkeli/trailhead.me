const joi = require('joi');
const { request } = require('modules/util');
const ID = require('modules/id');

// prettier-ignore
const schema = joi.object({
  commentID: joi.number().integer().min(1).required(),
});

module.exports = request(async (trx, req, res) => {
  // Validate the incoming request with Joi
  const valid = joi.validate(req.body, schema);
  if (valid.error) {
    return { status: 'validation error', error: valid.error };
  }

  // Convert hash id onto a numerical one
  const postID = ID.post.decode(req.params.post)[0];
  if (!postID) {
    return {
      status: 'not found',
      error: 'Post does not exist',
    };
  }

  // Check if user is logged in
  if (!req.session.isPopulated) {
    return {
      status: 'forbidden',
      error: 'Invalid session, please login again...',
    };
  }

  // Find the comment that the user is trying to edit
  const [[comment]] = await trx.execute(
    `SELECT userID, commentID FROM comment WHERE commentID = ? and postID = ?`,
    [req.body.commentID, postID]
  );

  // Check if the comment exists
  if (!comment) {
    return {
      status: 'forbidden',
      error: 'Comment does not exist',
    };
  }

  // Is the comment user's comment
  if (comment.userID !== req.session.userID) {
    return {
      status: 'forbidden',
      error: 'No right to remove comment',
    };
  }

  // Deletes comment
  await trx.execute(`DELETE FROM comment WHERE commentID = ?;`, [
    comment.commentID,
  ]);

  return { status: 'ok' };
});
