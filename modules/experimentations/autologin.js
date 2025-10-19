/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.0 (Avalanche)
 * 
 */

const heliactylModule = {
  "name": "Heliactyl Autologin",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const jwt = require('jsonwebtoken');
const { requireAuth } = require("../../handlers/requireAuth.js");


let secretKey = settings.website.secret;

module.exports.load = async function (app, db) {
  app.get("/panel/doAutologin", requireAuth, async (req,res) => {
    let jwtData = {
        email: req.session.userinfo.email,
        isValidLogin: true
    };
    let token = jwt.sign(jwtData,secretKey,{expiresIn:'1h'});
    res.redirect(`${settings.pterodactyl.domain}/auth/autologin/callback/${token}`)
  });
};

// don't use that, it a big security issue
// <?php
// 
// namespace Pterodactyl\Http\Controllers\Auth;
// 
// use Pterodactyl\Http\Controllers\Controller;
// use Illuminate\Http\Request;
// use Firebase\JWT\JWT;
// use Firebase\JWT\Key;
// use Illuminate\Support\Facades\Auth;
// use Pterodactyl\Models\User;
// 
// class AutoLoginController extends Controller
// {
//     private $secretKey = "=-=";
// 
//     public function callback(Request $request, $token)
//     {
//         try {
//             $decoded = JWT\JWT::decode($token, new Key($this->secretKey, 'HS256'));
//             
//             if ($decoded->isValidLogin) {
//                 $user = User::where('email', $decoded->email)->first();
//                 
//                 if ($user) {
//                     Auth::login($user);
//                     return redirect('/');
//                 }
//             }
//             
//             return redirect('/auth/login')->with('error', 'Login automatique échoué');
//         } catch (\Exception $e) {
//             return redirect('/auth/login')->with('error', 'Token invalide');
//         }
//     }
// }

// Route::get('/auth/autologin/callback/{token}', [AutoLoginController::class, 'callback'])->name('auth.autologin.callback');

// composer require firebase/php-jwt