// Import Sequelize and Model
const { DataTypes, Model } = require("sequelize");

const Utils = require("../utils/utils");
const utils = new Utils();
const BaseModel = require("./BaseModel")();

/**
 * @param {object} sequelize : DB connection
 * @param {object} parent : parent class model (ex: SysMetaData)
 * @param {object} sysDictionary : SysDictionary model for cascade create and delete of collections and fields
 * @returns {object} SysDbObject model
 */
module.exports = (sequelize, parent) => {
  
  class SysDbObject extends Model {
    static table_name = "sys_db_object";
    static attr = {
      ...parent.attr,
      name: DataTypes.STRING(80),
      label: DataTypes.STRING(80),
      super_class: DataTypes.STRING(32),
    };

    /**
     * Get the super class table name for a given table
     * @param {string} tableName - The name of the table to check
     * @returns {Promise<string|null>} - Super class table name or null if no super class exists
     */
    static async getSuperClass(tableName, options = {}) {
      try {
        const result = await this.findOne({
          where: { name: tableName },
          attributes: ['super_class'],
        });
        return result?.dataValues?.super_class || null;
      } catch (error) {
        console.error('[SysDbObject::getSuperClass] Error:', error);
        throw error; // Rethrow the error to be handled by the caller
      }
    }

    /**
     * Get all child tables for a given table (tables that inherit from it)
     * @param {string} tableName - The name of the parent table
     * @returns {Promise<Array<string>>} - Array of child table names
     */
    static async getChildTables(tableName, options = {}) {
      try {
        const results = await this.findAll({
          where: { super_class: tableName },
          attributes: ['name'],
        });
        return results.map(result => result.dataValues.name);
      } catch (error) {
        console.error('[SysDbObject::getChildTables] Error:', error);
        throw error; // Rethrow the error to be handled by the caller
      }
    }

    // Helper method to format table name for display
    static _formatDisplayName(name) {
      // Remove 'u_' prefix if it exists
      const cleanName = name.startsWith('u_') ? name.substring(2) : name;
      return cleanName
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }

    // Overload the `create` method
    static async create(data, options) {
      data.sys_class_name = this.table_name;
      data.sys_name = this._formatDisplayName(data.name);
      let record = {};

      // Create record if table name not nil
      if (!utils.nil(data.name)) {
        // Call the default `create` method using `super.create`
        record = await super.create(data, options);
        await this.createTableIfNotExists(data.name);
        await parent.create(data, options); // create record in parent table (sys_metadata)

        await this.sysDictionary.createCollection(data, options);
        
        // If super_class is specified, copy fields from parent table otherwise, use base model fields
        // await this.sysDictionary._copyParentFields(data.name, data.super_class);
        // DO NOT COPY PARENT FIELDS. USE PARENT FIELDS IN CHILD TABLES !
      }

      return new Promise((resolve, reject) => {
        if (!utils.nil(record))
          resolve(record);
        else
          reject("[SysDbObject::create] Could not create table. Missing name attribute");
      });
    }

    // Overload the `destroy` method
    static async destroy(data, options) {
      const { name } = data.where;

      // Delete record if table name not nil
      if (!utils.nil(name)) {
        try {
          // Get the record first to access its sys_id
          const record = await super.findOne({ where: { name } });
          if (!record) {
            console.log("SysDbObject - No record found with name:", name);
            return;
          }
          // Finally, drop the actual database table
          await this.dropTableIfExists(name);

          // Delete related records in sys_dictionary first (collection and its fields)
          await this.sysDictionary.deleteCollection(data, options);

          // Delete the corresponding record in sys_metadata with the same sys_id
          // await parent.destroy({ where: { sys_id: record.sys_id } }, options); // cascade delete of the record in parent table is handled by cascade delete in sequlizer

          // Delete the record in sys_db_object
          await super.destroy(data, options);
        } catch (e) {
          console.error("SysDbObject - Cascade delete error:", e);
          throw e; // Rethrow the error to be handled by the caller
        }
      }

      return;
    }

    /**
     * Creates the actual database table if it does not already exist
     * @param {Object} data Model of the table to create
     * @returns {Promise<{status: string, message: string}>} Result of the table creation
     */
    static async createTableIfNotExists(name) {
      const queryInterface = sequelize.getQueryInterface();
      try {
        // Check if the table exists
        await queryInterface.describeTable(name);
        utils.warn("tablename %s already exists !", name);
        return {
          status: "error",
          message: `Table "${name}" already exists !`,
        };
      } catch (e) {
        await queryInterface.createTable(name, BaseModel.getAttributes());
        return { status: "success", message: `New table "${name}" created !` };
      }
    }

    /**
     * @param {string} tableName name of the table to delete
     */
    static async dropTableIfExists(tableName) {
      // utils.warn("SYS_DB_OBJECT - dropTable - Deleting table : %s", tableName);
      try {
        const queryInterface = sequelize.getQueryInterface();
        queryInterface
          .describeTable(tableName)
          .then((table) => {
            if (table) {
              console.log("SYS_DB_OBJECT - dropTable - Deleting table : %s", tableName);
              queryInterface.dropTable(tableName);
            } else {
              console.log("SYS_DB_OBJECT - dropTable - %s does not exist", tableName);
            }
          })
          .catch((error) => console.error(error));
      } catch (e) {
        console.error("SYS_DB_OBJECT - dropTable - Error : %s", e);
      }
    }
  }

  // Initialize the SysGlideObject class by calling the init method
  SysDbObject.init(SysDbObject.attr, {
    // Specify the sequelize instance and the table name
    sequelize,
    modelName: SysDbObject.table_name,
    tableName: SysDbObject.table_name,
    hooks: {
      beforeCreate: (SysDbObjectModel, options) => {
        // Do something before creating a new sysMetadata instance
        console.log("\n\n[SysDbObject] BEFORE CREATE HOOK \n\n");
      },
      afterCreate: (SysDbObjectModel, options) => {
        console.log("\n\n[SysDbObject] AFTER CREATE HOOK \n\n");
      },
      beforeUpdate: (SysDbObjectModel, options) => {
        // Do something before updating a sysMetadata instance
        console.log("\n\n[SysDbObject] BEFORE UPDATE HOOK \n\n");
      },
      afterUpdate: (SysDbObjectModel, options) => {
        // Do something after updating a sysMetadata instance
        console.log("\n\n[SysDbObject] AFTER UPDATE HOOK \n\n");
      },
      beforeBulkDestroy: (SysDbObjectModel) => {
        // Do something before destroying a sysMetadata instance
        console.log("\n\n[SysDbObject] BEFORE DESTROY HOOK \n\n");
      },
      afterBulkDestroy: () => {
        // Do something after destroying a sysMetadata instance
        console.log("\n\n[SysDbObject] AFTER DESTROY HOOK \n\n");
      },
    },
  });

  return SysDbObject;
};
