var crypto = require("crypto");

function ORM(db) {
	this._db = db;
	this._models = {};
}

ORM.prototype.model = function (model) {
	return this._models.hasOwnProperty(model) ? this._models[model] : null;
};

ORM.prototype.define = function (model, fields, colParams) {
	var orm = this,
	    associations = [];

	var addOneAssociationMethods = function (model, association, associationModel) {
		var camelCaseAssociation = association.substr(0, 1).toUpperCase() + association.substr(1);

		model.prototype["get" + camelCaseAssociation] = function (cb) {
			var self = this;

			if (self[association + "_id"] > 0) {
				if (self[association]) return cb(self[association]);

				var data = {};
				data[model + "_id"] = this.id;

				orm._db.selectRecords(model, {
					"conditions": { "id": self[association + "_id"] },
					"callback"	: function (err, data) {
						if (err || !data || data.length == 0) return cb(null);

						cb(new Model(data[0]));
					}
				});
				return;
			}
			cb(null);
		};
		model.prototype["unset" + camelCaseAssociation] = function (cb) {
			this["set" + camelCaseAssociation](null, cb);
		};
		model.prototype["set" + camelCaseAssociation] = function (instance, cb) {
			var self = this;

			if (instance === null) {
				self[association + "_id"] = 0;
				delete self[association];

				return cb();
			}

			if (!instance.saved()) {
				instance.save(function (err, savedInstance) {
					if (err) return cb(err);

					self[association + "_id"] = savedInstance.id;
					self[association] = savedInstance;
					cb();
				});
				return;
			}
			self[association + "_id"] = instance.id;
			self[association] = instance;
			cb();
		};
	};
	var addManyAssociationMethods = function (self, association, field) {
		var camelCaseAssociation = association.substr(0, 1).toUpperCase() + association.substr(1);
		var collection = model + "_" + association;

		self.prototype["add" + camelCaseAssociation] = function () {
			var instances = [], cb = null;
			var data = {};
			data[model + "_id"] = this.id;

			for (var i = 0; i < arguments.length; i++) {
				if (typeof arguments[i] == "function") {
					cb = arguments[i];
				} else {
					instances.push(arguments[i]);
				}
			}

			if (instances.length == 0) {
				throw { "message": "No " + camelCaseAssociation + " were given" };
			}

			var missingInstances = instances.length;

			instances.forEach(function (instance) {
				if (!instance.saved()) {
					instance.save(function (err, savedInstance) {
						if (err) return cb(err);

						data[field + "_id"] = savedInstance.id;

						orm._db.saveRecord(collection, data, function (err) {
							if (--missingInstances == 0) cb(null);
						});
					});
					return;
				}

				data[field + "_id"] = instance.id;
				orm._db.saveRecord(collection, data, function (err) {
					if (--missingInstances == 0) cb(null);
				});
			});
		};

		self.prototype["remove" + camelCaseAssociation] = function () {
			var instances = [],
			    cb = null,
			    data = {};

			data[model + "_id"] = this.id;

			for (var i = 0; i < arguments.length; i++) {
				if (typeof arguments[i] == "function") {
					cb = arguments[i];
				} else {
					instances.push(arguments[i]);
				}
			}

			if (instances.length == 0) {
				orm._db.clearRecords(collection, {
					"conditions"	: data,
					"callback"		: function () {
						cb(null);
					}
				});
				return;
			}

			var missingInstances = instances.length;

			instances.forEach(function (instance) {
				if (typeof instance.id == "undefined" || instance.id == 0) {
					if (--missingInstances == 0) cb(null);
					return;
				}

				data[field + "_id"] = instance.id;

				orm._db.clearRecords(collection, {
					"conditions"	: data,
					"callback"		: function () {
						if (--missingInstances == 0) cb(null);
					}
				});
			});
		};

		self.prototype["set" + camelCaseAssociation] = function () {
			var instances = [],
			    cb = null,
			    data = {};

			data[model + "_id"] = this.id;

			for (var i = 0; i < arguments.length; i++) {
				if (typeof arguments[i] == "function") {
					cb = arguments[i];
				} else {
					instances.push(arguments[i]);
				}
			}

			orm._db.clearRecords(collection, {
				"conditions"	: data,
				"callback"		: function () {
					if (instances.length == 0) return cb(null);

					var missingInstances = instances.length;

					instances.forEach(function (instance) {
						if (!instance.saved()) {
							instance.save(function (err, savedInstance) {
								if (err) return cb(err);

								data[field + "_id"] = savedInstance.id;

								orm._db.saveRecord(collection, data, function (err) {
									if (--missingInstances == 0) cb(null);
								});
							});
							return;
						}

						data[field + "_id"] = instance.id;
						orm._db.saveRecord(collection, data, function (err) {
							if (--missingInstances == 0) cb(null);
						});
					});
				}
			});
		};

		self.prototype["get" + camelCaseAssociation] = function (cb) {
			var items = [],
			    conditions = {};

			conditions[model + "_id"] = this.id;

			orm._db.selectRecords(collection, {
				"conditions": conditions,
				"callback"	: function (err, data) {
					if (err) return cb(null);

					var ids = [];
					for (var i = 0; i < data.length; i++) {
						ids.push(data[i][field + "_id"]);
					}

					orm._db.selectRecords(model, {
						"conditions": { "id": ids },
						"callback"	: function (err, data) {
							if (err) return cb(null);

							for (var i = 0; i < data.length; i++) {
								data[i] = new Model(data[i]);
							}

							cb(data);
						}
					});
				}
			});
		};
	};

	var Model = function (data) {
		if (data) {
			for (k in data) {
				if (!data.hasOwnProperty(k)) continue;

				if (fields.hasOwnProperty(k)) {
					switch (fields[k].type) {
						case "bool":
						case "boolean":
							data[k] = (data[k] == 1);
							break;
						case "struct":
							if (typeof data[k] == "string") {
								try {
									data[k] = (data[k].length > 0 ? JSON.parse(data[k]) : {});
								} catch (e) {
									data[k] = {};
								}
							}
					}
				}

				this[k] = data[k];
			}
		}
		for (k in fields) {
			if (!fields.hasOwnProperty(k)) continue;
			if (!data.hasOwnProperty(k) && fields[k].def) this[k] = fields[k].def;
		}
		for (var i = 0; i < associations.length; i++) {
			switch (associations[i].type) {
				case "one":
					if (!this.hasOwnProperty(associations[i].field + "_id")) {
						this[associations[i].field + "_id"] = data[associations[i].field + "_id"] = 0;
					}
					break;
			}
		}

		if (colParams && colParams.methods) {
			for (k in colParams.methods) {
				this[k] = data[k] = colParams.methods[k];
			}
		}

		var h = crypto.createHash("md5");
		h.update(JSON.stringify(data));

		this._dataHash = h.digest("hex");
	};
	Model._eventListeners = {};
	Model.on = function (ev, cb) {
		if (!this._eventListeners.hasOwnProperty(ev)) {
			this._eventListeners[ev] = [];
		}
		this._eventListeners[ev].push(cb);
		return this;
	};
	Model.emit = function () {
		var args = Array.prototype.slice.call(arguments),
		    ev = args.splice(0, 1);
		
		if (!this._eventListeners.hasOwnProperty(ev)) return;

		for (var i = 0; i < this._eventListeners[ev].length; i++) {
			this._eventListeners[ev][i].call(this, args);
		}
		//console.log("event '%s'", ev, args);
	};

	Model.prototype._getData = function () {
		var data = {};

		if (this.hasOwnProperty("id")) {
			data.id = this.id;
		}

		for (k in fields) {
			if (!fields.hasOwnProperty(k)) continue;

			switch (fields[k].type) {
				case "bool":
				case "boolean":
					data[k] = (this[k] == 1);
					break;
				case "date":
					if (this[k]) {
						data[k] = (this[k].toJSON ? this[k].toJSON() : null);
					} else {
						data[k] = "0000-00-00";
					}
					break;
				case "struct":
					if (this[k]) {
						data[k] = (typeof this[k] == "object" ? JSON.stringify(this[k]) : this[k]);
					} else {
						data[k] = "";
					}
					break;
				default:
					data[k] = this[k];
			}
		}

		for (var i = 0; i < associations.length; i++) {
			switch (associations[i].type) {
				case "one":
					if (this.hasOwnProperty(associations[i].field + "_id")) {
						data[associations[i].field + "_id"] = this[associations[i].field + "_id"];
					}
			}
		}

		return data;
	};
	Model.prototype.saved = function () {
		var h = crypto.createHash("md5");
		h.update(JSON.stringify(this._getData()));

		return (this._dataHash == h.digest("hex"));
	};
	Model.prototype.created = function () {
		return this.hasOwnProperty("id");
	};
	Model.prototype.save = function () {
		var callback = function () {}, opts = {}, data = {}, self = this;
		var saveRecord = function () {
			orm._db.saveRecord(model, data, function (err, id) {
				if (err) {
					if (colParams && colParams.hooks && typeof colParams.hooks.afterSave == "function") {
						colParams.hooks.afterSave(false, self);
					}
					if (typeof callback == "function") {
						callback(err);
					}
					return;
				}

				if (!self.id) self.id = id;

				if (colParams && colParams.hooks && typeof colParams.hooks.afterSave == "function") {
					colParams.hooks.afterSave(true, self);
				}

				if (typeof callback == "function") {
					callback(null, self);
				}
			});
		};

		for (var i = 0; i < arguments.length; i++) {
			if (typeof arguments[i] == "function") {
				callback = arguments[i];
			} else if (typeof arguments[i] == "object") {
				opts = arguments[i] || {}; // avoid null (yes, it's an object)
			}
		}

		if (colParams && colParams.hooks && typeof colParams.hooks.beforeSave == "function") {
			colParams.hooks.beforeSave(this);
		}

		data = this._getData();

		if (colParams && colParams.validations) {
			var validators = [];

			for (field in colParams.validations) {
				if (!colParams.validations.hasOwnProperty(field)
				|| !data.hasOwnProperty(field)) continue;

				if (typeof colParams.validations[field] === "function") {
					validators.push([ field, data[field], colParams.validations[field] ]);
				} else if (Array.isArray(colParams.validations[field])) {
					for (var i = 0; i < colParams.validations[field].length; i++) {
						validators.push([ field, data[field], colParams.validations[field][i] ]);
					}
				}
			}

			if (validators.length > 0) {
				var validatorIndex = 0, errors = [];
				var validatorNext = function (response) {
					if (typeof response == "undefined" || response === true) {
						validatorIndex++;
						return callNextValidator();
					}
					errors.push({
						"type": "validator",
						"field": validators[validatorIndex][0],
						"value": validators[validatorIndex][1],
						"msg": response
					});
					if (opts.validateAll) {
						validatorIndex++;
						return callNextValidator();
					}
					return callback(errors[0]);
				};
				var callNextValidator = function () {
					if (validatorIndex >= validators.length) {
						if (opts.validateAll && errors.length > 0) {
							return callback(errors);
						}
						return saveRecord();
					}
					validators[validatorIndex][2].apply(self, [ validators[validatorIndex][1], validatorNext, data, Model, validators[validatorIndex][0] ]);
				};
				return callNextValidator();
			}
		}

		return saveRecord();
	};
	Model.hasOne = function (association, otherModel) {
		var model = !otherModel ? this : otherModel;
		associations.push({
			"field"	: association,
			"type"	: "one",
			"model"	: model	// this = circular reference
		});
		addOneAssociationMethods(this, association, model);
	};
	Model.hasMany = function (association, otherModel, field) {
		var model = !otherModel ? this : otherModel;
		associations.push({
			"field"	: association,
			"name"	: field,
			"type"	: "many",
			"model"	: model	// this = circular reference
		});
		addManyAssociationMethods(this, association, field);
	};
	Model.sync = function () {
		orm._db.createCollection(model, fields, associations);
	};
	Model.clear = function (callback) {
		orm._db.clearRecords(model, {
			"callback": function (err, info) {
				if (typeof callback == "function") callback(!err);
			}
		});
	};
	Model.prototype.remove = function (callback) {
		if (this.hasOwnProperty("id")) {
			var self = this;

			orm._db.clearRecords(model, {
				"conditions": { "id": this.id },
				"callback": function (err, info) {
					/*
						The object will still have all properties and you can save() later
						if you want (a new ID should be assigned)
					*/
					delete self.id;

					if (typeof callback == "function") callback(!err);
				}
			});
			return;
		}
		// no id so nothing to "unsave"
		if (typeof callback == "function") callback(true);
	};
	Model.get = function (id, callback) {
		orm._db.selectRecords(model, {
			"conditions": { "id": id },
			"callback"	: function (err, data) {
				if (err || data.length == 0) return callback(null);

				callback(new Model(data[0]));
			}
		});
	};
	Model.find = function () {
		var args = arguments,
		    callback = null,
		    config = {},
		    last_arg = arguments.length - 1;

		if (last_arg >= 0 && typeof arguments[last_arg] == "function") {
			callback = arguments[last_arg];
			last_arg--;
		}

		//.find(callback);
		//.find(conditions, callback);
		//.find(conditions, limit, callback);
		//.find(conditions, order, callback);
		//.find(conditions, order, limit, callback);

		for (var i = 0; i <= last_arg; i++) {
			switch (typeof arguments[i]) {
				case "object": // conditions
					config.conditions = arguments[i];
					break;
				case "number": // limit
					config.limit = arguments[i];
					break;
				case "string": // order
					config.order = arguments[i];
					break;
			}
		}

		if (callback !== null) {
			config.callback = function (err, data) {
				if (err || data.length == 0) return callback(null);

				for (var i = 0; i < data.length; i++) {
					data[i] = new Model(data[i]);
				}
				callback(data);
			};
			orm._db.selectRecords(model, config);

			return this;
		} else {
			var query = orm._db.selectRecords(model, config);

			(function (m) {
				query.on("record", function (record) {
					m.emit("record", new Model(record));
				});
				query.on("end", function (info) {
					// info not properly processed yet
					m.emit("end");
				});
				query.on("error", function (err) {
					m.emit("error", err);
				});
			})(this);

			return query;
		}
	};
	Model.textsearch = function () {
		var args = arguments,
		    callback = null,
		    config = {},
		    last_arg = arguments.length - 1;

		if (last_arg >= 0) {
			callback = arguments[last_arg];
			last_arg--;
		}

		if (!orm._db.searchRecords) {
			return callback(null);
		}

		//.textsearch(text, callback);
		//.textsearch(text, limit, callback);
		//.textsearch(limit, text, callback);

		for (var i = 0; i <= last_arg; i++) {
			switch (typeof arguments[i]) {
				case "number": // limit
					config.limit = arguments[i];
					break;
				case "string": // text
					config.text = arguments[i];
					break;
			}
		}

		if (!config.text) return callback(null);

		if (callback !== null) {
			config.callback = function (err, data) {
				if (err || data.length == 0) return callback(null);

				for (var i = 0; i < data.length; i++) {
					data[i] = new Model(data[i]);
				}
				callback(data);
			};
		}
		orm._db.searchRecords(model, config);
	};

	colParams || (colParams = {});
	for (k in fields) {
		if (!fields.hasOwnProperty(k)) continue;
		if (typeof fields[k] == "function") {
			fields[k] = { "type": typeof (fields[k]()) };
		} else if (typeof fields[k] == "string") {
			fields[k] = { "type": fields[k].toLowerCase() };
		}
	}

	this._models[model] = Model;
	if (!module.exports.hasOwnProperty(model)) {
		module.exports[model] = this._models[model];
	}

	return this._models[model];
};

ORM.prototype.end = function () {
    this._db.end();
};

ORM.prototype.getConnection = function () {
	return this._db;
}

ORM.prototype.getClient = function () {
	return this._db.getClient();
}

module.exports = {
	"validators": require("./validators"),
	"connect"   : function (/* uri_or_dbtype, [db_object], callback */) {
		var rawDb, callback, uri, dbType;

		if (arguments.length === 3) {
			callback = arguments[2];
			rawDb = arguments[1];
			dbType = arguments[0];
		} else {
			callback = arguments[1];
			var url = require("url");
			uri = url.parse(arguments[0]);
			if (!uri.protocol) {
				return callback(false, { "number": 1, "message": "Protocol not defined" });
			}
			dbType = uri.protocol.substr(0, uri.protocol.length - 1);
		}

		var path = require("path"), dbPath = __dirname + "/databases/" + dbType + ".js";

		path.exists(dbPath, function (exists) {
			if (!exists) {
				return callback(false, { "number": 2, "message": "Protocol not installed" });
			}

			var db = require(dbPath);

			var handleResult = function (success, info) {
				if (!success) return callback(false, info);

				return callback(true, new ORM(info));
			};

			if (rawDb) {
				db.use_db(rawDb, handleResult);
			} else {
				db.connect(uri, handleResult);
			}
		});
	}
};
