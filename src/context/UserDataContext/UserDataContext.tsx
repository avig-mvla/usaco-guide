import * as React from 'react';
import { createContext, useReducer, useState } from 'react';
import ReactDOM from 'react-dom';
import useFirebase from '../../hooks/useFirebase';
import UserLang, { UserLangAPI } from './properties/userLang';
import UserDataPropertyAPI from './userDataPropertyAPI';
import LastViewedModule, {
  LastViewedModuleAPI,
} from './properties/lastViewedModule';
import HideTagsAndSolutions, {
  HideTagsAndSolutionsAPI,
} from './properties/hideTagsAndSolutions';
import DarkMode, { DarkModeAPI } from './properties/darkMode';
import LastReadAnnouncement, {
  LastReadAnnouncementAPI,
} from './properties/lastReadAnnouncement';
import UserProgressOnModulesProperty, {
  UserProgressOnModulesAPI,
} from './properties/userProgressOnModules';
import UserProgressOnProblemsProperty, {
  UserProgressOnProblemsAPI,
} from './properties/userProgressOnProblems';
import LastVisitProperty, { LastVisitAPI } from './properties/lastVisit';

// Object for counting online users
var Gathering = (function () {
  function Gathering(databaseReference) {
    this.db = databaseReference;

    this.room = this.db.ref('gatherings/globe');
    this.user = null;

    this.join = function (uid) {
      if (this.user) {
        console.error('Already joined.');
        return false;
      }

      this.user = uid ? this.room.child(uid) : this.room.push();

      // Add user to presence list when online.
      var presenceRef = this.db.ref('.info/connected');
      let self = this;
      presenceRef.on('value', function (snap) {
        if (snap.val()) {
          self.user.onDisconnect().remove();
          self.user.set(true);
        }
      });
      return true;
    };

    this.leave = function () {
      this.user.remove();
    };

    this.over = function () {
      this.room.remove();
    };

    this.onUpdated = function (callback) {
      if ('function' == typeof callback) {
        this.room.on('value', function (snap) {
          callback(snap.numChildren(), snap.val());
        });
      } else {
        console.error(
          'You have to pass a callback function to onUpdated(). That function will be called (with user count and hash of users as param) every time the user list changed.'
        );
      }
    };
  }

  return Gathering;
})();

/*
 * todo document how to add new API to user data context?
 *
 * for now looking in the `properties/` folder probably suffices...
 */

const UserDataContextAPIs: UserDataPropertyAPI[] = [
  new UserLang(),
  new LastViewedModule(),
  new HideTagsAndSolutions(),
  new DarkMode(),
  new LastReadAnnouncement(),
  new UserProgressOnModulesProperty(),
  new UserProgressOnProblemsProperty(),
  new LastVisitProperty(),
];

type UserDataContextAPI = UserLangAPI &
  LastViewedModuleAPI &
  HideTagsAndSolutionsAPI &
  DarkModeAPI &
  LastReadAnnouncementAPI &
  UserProgressOnModulesAPI &
  UserProgressOnProblemsAPI &
  LastVisitAPI & {
    firebaseUser: any;
    signIn: Function;
    signOut: Function;
    isLoaded: boolean;
    onlineUsers: number;
  };

const UserDataContext = createContext<UserDataContextAPI>(null);

export const UserDataProvider = ({ children }) => {
  const firebase = useFirebase();

  const [firebaseUser, setFirebaseUser] = useReducer((_, user) => {
    // when the firebase user changes, update all the API's
    const userDoc = user
      ? firebase.firestore().collection('users').doc(user.uid)
      : null;
    UserDataContextAPIs.forEach(api => api.setFirebaseUserDoc(userDoc));

    return user;
  }, null);

  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  const [onlineUsers, setOnlineUsers] = useState(0);

  const [_, triggerRerender] = useReducer(cur => cur + 1, 0);
  UserDataContextAPIs.forEach(api =>
    api.setTriggerRerenderFunction(triggerRerender)
  );

  // Listen for firebase user sign in / sign out
  useFirebase(firebase => {
    return firebase.auth().onAuthStateChanged(user => {
      if (user == null) setIsLoaded(true);
      else setIsLoaded(false);
      setFirebaseUser(user);
    });
  });

  // Count online users
  useFirebase(firebase => {
    let online = new Gathering(firebase.database());
    online.join();
    online.onUpdated(function (count) {
      setOnlineUsers(count);
    });
  });

  // just once, ask all API's to initialize their values from localStorage
  React.useEffect(() => {
    UserDataContextAPIs.forEach(api => api.initializeFromLocalStorage());
  }, []);

  // If the user is signed in, sync remote data with local data
  React.useEffect(() => {
    if (firebaseUser) {
      return firebase
        .firestore()
        .collection('users')
        .doc(firebaseUser.uid)
        .onSnapshot(snapshot => {
          let data = snapshot.data();
          if (!data) {
            let lastViewedModule = UserDataContextAPIs.find(
              x => x instanceof LastViewedModule
            ).exportValue();
            let localDataIsNotEmpty = lastViewedModule !== null;

            if (localDataIsNotEmpty) {
              if (
                confirm(
                  `Upload local progress to server? (You'll lose your local progress if you don't)`
                )
              ) {
                // sync all local data with firebase if the firebase account doesn't exist yet
                firebase
                  .firestore()
                  .collection('users')
                  .doc(firebaseUser.uid)
                  .set(
                    UserDataContextAPIs.reduce((acc, cur) => {
                      return {
                        ...acc,
                        ...cur.exportValue(),
                      };
                    }, {}),
                    { merge: true }
                  );
              }
            }
          }
          data = data || {};
          ReactDOM.unstable_batchedUpdates(() => {
            UserDataContextAPIs.forEach(api => api.importValueFromObject(data));
            UserDataContextAPIs.forEach(api => api.writeValueToLocalStorage());
            setIsLoaded(true);
            triggerRerender();
          });
        });
    }
  }, [firebaseUser]);

  const userData = {
    firebaseUser,
    signIn: () => {
      firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    },
    signOut: () => {
      firebase
        .auth()
        .signOut()
        .then(() => {
          UserDataContextAPIs.forEach(api => api.eraseFromLocalStorage());
          window.location.reload();
        });
    },
    isLoaded,
    onlineUsers,

    ...UserDataContextAPIs.reduce((acc, api) => {
      return {
        ...acc,
        ...api.getAPI(),
      };
    }, {}),
  };

  return (
    <UserDataContext.Provider value={userData}>
      {children}
    </UserDataContext.Provider>
  );
};

export default UserDataContext;
